# Detailed gap file — module `tenant-admin`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 161, BACKEND-VERIFY 34, CANNOT-VERIFY 1



---
## /tenant-admin  —  `tenant-admin/home.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/home.html`

### GAP-TENANT-ADMIN-HOME-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Export report links to /tenant-admin/audit?export=true, but audit/page.tsx never reads searchParams — the query does nothing; the user just lands on the log (page.tsx:30 vs audit/page.tsx:9-53).
- **Verified evidence:** apps/web/src/app/(app)/tenant-admin/page.tsx:30 renders <a href="/tenant-admin/audit?export=true">Export report</a>; audit/page.tsx:9-53 is a server component with no props/searchParams, so the query is ignored. The only export on the audit page is PrintExportButton (audit/page.tsx:28) - a client-side print, with no audit of the export itself and no server-side export endpoint visible in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/page.tsx`, `apps/web/src/app/(app)/tenant-admin/audit/page.tsx`
- **Fix steps:**
  1. Short term: change the home link to plain /tenant-admin/audit labelled 'View audit log' (drop the false export claim).
  2. Long term: add a real export - either accept searchParams.export in audit/page.tsx and render the existing PrintExportButton auto-focused, or add a server export route that streams CSV.
  3. Any export of audit data must itself write an audit event (CLAUDE.md rule 8) and be limited to appropriate roles - needs backend endpoint.
  4. Remove 'export=true' once done.
- **Acceptance:**
  - Manual: the home action's label matches what happens on click.
  - If export is implemented: downloaded file contains the filtered events and an 'audit.exported' event appears in the log.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Only the link fix is XS; real audited CSV export needs backend and is M.

### GAP-TENANT-ADMIN-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** On source==='error' only KPIs are blanked; health pill falls back to 'down' and modules card to 'No modules', so a transient failure reads as a platform outage (page.tsx:19-46, loaders.ts fallback {status:'down'}).
- **Verified evidence:** page.tsx:19 errored = source==='error'; KPIs blank at line 38 but health pill (line 46) reads health.status and the Enabled-modules card (lines 59-72) reads modules.length. getTenantAdminDashboard (_data/loaders.ts:914-955) sets source='error' if ANY of users/modules/health/readiness fails and health falls back to {status:'down', services:[]} (loaders.ts:919), modules to [] -> pill shows 'down' (class 'bad') and EmptyState 'No modules'. Only a small DataSourceBadge (line 41) explains it, placed below the KPIs.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. In page.tsx, when errored show the health pill as '—' with a neutral class and skip the health DataTable, replacing it with RefreshErrorState (toHumanError('load',{area:'service health'})).
  2. Same for modules card: on errored render RefreshErrorState instead of the 'No modules' EmptyState and hide the 'configured' count.
  3. Better: expose per-part source flags from getTenantAdminDashboard (healthSource, modulesSource, usersSource) so only the failed panel degrades.
  4. Reuse the pattern already used in idp/install/mfa pages (toResourceState + RefreshErrorState).
- **Acceptance:**
  - Test: loader mock with health failing -> health card shows retry error state, not 'down'.
  - Test: modules failing -> no 'No modules' message.
  - Manual: with all sources healthy the page is unchanged.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; health 'down' false alarms currently mislead operators.
- **Depends on:** RefreshErrorState

### GAP-TENANT-ADMIN-HOME-03  ·  MEDIUM  ·  partly  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Invite user is a PlaceholderButton with no action; primary CTA of the page is dead (page.tsx:32).
- **Verified evidence:** page.tsx:32 renders <PlaceholderButton label="Invite user" variant="primary"/>. Per _components/PlaceholderButton.tsx it renders as a disabled control with a title and visible 'coming soon' tag (not a silent dead click), so it is honest but the primary CTA is non-functional. A working invite flow already exists: tenant-admin/users/UsersTable.tsx:32,74 (inviteOpen state, '+ Invite User' button).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/page.tsx`, `apps/web/src/app/(app)/tenant-admin/users/UsersTable.tsx`
- **Fix steps:**
  1. Replace PlaceholderButton with <a className="btn primary" href="/tenant-admin/users?invite=1">Invite user</a> (minHeight 44 as elsewhere).
  2. In UsersTable initialise inviteOpen from the invite=1 search param (pass searchParams from users/page.tsx or use useSearchParams).
  3. Remove the now-unused PlaceholderButton import from page.tsx.
- **Acceptance:**
  - Manual: clicking Invite user on /tenant-admin lands on /tenant-admin/users with the invite dialog open.
  - Component test: UsersTable with invite param opens the dialog.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; reuses existing invite flow.

### GAP-TENANT-ADMIN-HOME-04  ·  MEDIUM  ·  confirmed  ·  theme I18N

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Every enabled module is labelled 'Active' unconditionally, and the count pill reads 'configured' (page.tsx:59,66) — no per-module status is read.
- **Verified evidence:** page.tsx:66 hard-codes <span className="pill good">Active</span> for every module and line 59 shows '{modules.length} configured'. The modules come from getTenantSettings -> mapTenantSettings (_data/loaders.ts:669-686) which maps each row to {name} only, so no per-module status is available; the card title says 'Enabled modules' so the 'Active' label is redundant/unverified. Strings are English literals (no next-intl in these files).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Drop the per-row 'Active' pill (the card already says enabled) or map a real status from the API if /api/v1/admin/tenant/modules returns one (extend mapTenantSettings and the type from @civitasone/types after checking the response).
  2. Change '{n} configured' to '{n} enabled'.
  3. Add aria text where a status is kept, using StatusPill for consistent tone/label.
- **Acceptance:**
  - Component test: module list renders names without a fixed 'Active' claim unless status is present.
  - Count pill reads 'enabled'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; shared @civitasone/types not in snapshot, API status field unverified.

### GAP-TENANT-ADMIN-HOME-05  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Quick-nav uses emoji as icons and exposes SIEM/SSO/Settings tiles for roles that layout allows but sub-pages may gate differently; operations tile hidden but audit/security tiles shown to all three roles (page.tsx:77-103).
- **Verified evidence:** Quick-nav (page.tsx:77-98) uses emoji labels inside link text (announced by screen readers as emoji names) for 21 tiles. Role gating: layout.tsx:4 allows tenant_admin/platform_admin/super_admin; the header 'Operations' link is gated by canViewOperations (line 13) but the quick-nav is not, and tiles like Platform Config (line 93) point to platform-config/page.tsx:33 which requires platform_admin|super_admin, so a tenant_admin clicks through to a redirect/denied page. Operations is not in the quick-nav at all (so 'operations tile hidden' is accurate but trivial). SIEM/SSO/Audit/Security sub-pages have no extra role guard in the snapshot (only activation, org-type, operations, platform-config do), so those are visible and reachable to all three roles.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Fix steps:**
  1. Add a roles?: string[] field to each quick-nav item and filter with getSessionRoles() (already called at line 12) - at minimum hide Platform Config unless platform_admin/super_admin.
  2. Move emoji into an aria-hidden <span> beside the text label.
  3. Decide with product whether SIEM, Break-Glass and API Keys should be restricted to a narrower role and enforce via requireAnyRole on those pages (server-side).
- **Acceptance:**
  - Component/RSC test: tenant_admin session does not see Platform Config tile.
  - Screen-reader check: tile name reads 'Platform Config' without emoji description.
  - Manual: every visible tile opens without redirect for the current role.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Hiding tiles is cosmetic; real authorization must remain server-side.


---
## /tenant-admin/activation  —  `tenant-admin/activation.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/activation.html`

### GAP-TENANT-ADMIN-ACTIVATION-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** loadEvents() returns {events: []} on missing token, non-2xx and network failure, so an outage renders 'No activation events yet' and 0% — indistinguishable from a new tenant (activation/page.tsx:27,40,51).
- **Verified evidence:** Real file is tenant-admin/activation/page.tsx (the given source tenant-admin/page.tsx is the dashboard, which already gates KPIs on source==='error'). loadEvents() returns { events: [], platform } for missing token/base (l.27), non-2xx (l.40) and catch (l.52); ActivationPage then aggregates empty events: StatCards show 0 and '0%' (l.88-90) and the funnel says 'No activation events yet' (l.95-97), identical to a new tenant.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/activation/page.tsx`
- **Fix steps:**
  1. Change loadEvents return type to { events, platform, failed: boolean }; set failed=true for missing config/token, !res.ok and catch.
  2. In ActivationPage if failed render <RefreshErrorState error={...} backHref='/tenant-admin'/> (ds) instead of stats and funnel, or at least '—' in all StatCards.
  3. Keep the empty message only when failed===false and agg.totalOffices===0.
  4. Log the failure via existing telemetry helper if one is used by fetchJson (emitError).
- **Acceptance:**
  - Test: mock fetch 500, page shows retry state not 0%.
  - Test: 200 with events [] shows empty-state text.
  - Manual: retry button re-fetches.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Could reuse fetchJson from _data/apiClient to get status/telemetry consistency.
- **Depends on:** GAP-REVENUE-REFUNDS-DETAIL-DECIDE-04

### GAP-TENANT-ADMIN-ACTIVATION-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Footer tells admins events are 'kept in memory for this view; durable storage moves to the analytics service next' while the code claims to read durable events from analytics-service (page.tsx:57-61,129-132) — contradictory.
- **Verified evidence:** activation/page.tsx:57-61 docblock and PageHeader say durable events are read from analytics-service, and loadEvents fetches /api/v1/analytics/activation/funnel(/platform) (l.36-38), yet footer l.129-132 says 'Events are kept in memory for this view; durable storage moves to the analytics service next.' Contradictory; which is true depends on analytics-service (absent, cannot-verify).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/activation/page.tsx`
- **Fix steps:**
  1. Confirm with analytics-service owners whether events are durable.
  2. Replace footer with accurate copy, e.g. 'Based on events recorded by the analytics service.' or, if in-memory, correct the docblock.
  3. Keep the sentence about the biggest drop, moved into a insight line.
- **Acceptance:**
  - Manual: footer wording matches actual storage behaviour.
  - No 'moves to analytics service next' text remains if durable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-TENANT-ADMIN-ACTIVATION-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Tenant view shows 'Offices signed in'/'Offices activated' for a single office, so values are 0 or 1 and the funnel is meaningless outside platform scope (page.tsx:88-89).
- **Verified evidence:** activation/page.tsx:88-89 always shows 'Offices signed in' (agg.stages[0].reached) and 'Offices activated'. For non-platform users loadEvents uses the single-office endpoint (l.31-33) so events carry one tenantId and both values are 0 or 1; the funnel is 'Offices reached' with one office. Platform scope (getSessionRoles platform_admin/super_admin) is where these make sense.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/activation/page.tsx`
- **Fix steps:**
  1. When !platform hide the 'Offices signed in' and 'Offices activated' cards; show 'Setup progress' (steps completed of 8) and 'Time to first transaction' instead.
  2. Relabel funnel columns for tenant scope: 'Reached' as a checklist (done/not done with timestamp from events).
  3. Keep the current cards and table for platform scope.
- **Acceptance:**
  - Manual: tenant admin sees a step checklist, no 0/1 office counts.
  - Platform admin view unchanged.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; verify the events include timestamps per step for checklist.

### GAP-TENANT-ADMIN-ACTIVATION-04  ·  LOW  ·  confirmed  ·  theme TABLE (was NAVUX)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Funnel table is a plain .tbl without sort/mobile transform; no chart despite being a funnel (page.tsx:100).
- **Verified evidence:** activation/page.tsx:100 (cat l.207) uses a raw <table className='tbl'> with 4 columns, no sort, and no mobile transform; it is a funnel but no chart is drawn. ds/DataTable and app/_components/Chart.tsx (bar type, valueFormatter) exist; tenant-admin/page.tsx already uses DataTable. Theme NAVUX is wrong.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/activation/page.tsx`
- **Fix steps:**
  1. Add a horizontal/bar <Chart type='bar'> of stage.reached per step above the table, data built from agg.stages.
  2. Replace the raw table with ds/DataTable (columns Step, Reached, Dropped, Retained) for responsive behaviour.
  3. Keep the negative-drop colouring via cell renderer or pill.
- **Acceptance:**
  - Manual: chart renders reached counts; table stacks on phone width.
  - Empty state unchanged when no events.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Presentation only.


---
## /tenant-admin/ai-plugins  —  `tenant-admin/ai-plugins.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/ai-plugins.html`

### GAP-TENANT-ADMIN-AI-PLUGINS-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — UI PluginConfigControls + COALESCE insert defaults done; no audit event emitted in PATCH handler
- **First-pass claim:** Subtitle promises 'Enable, configure' but the page has no toggle, mode selector or threshold input; the backend PATCH /v1/hrms/ai/plugins/:pluginId exists (plugin-registry.ts:282) with no UI caller (page.tsx:74-158).
- **Verified evidence:** Source path in input is wrong: page is apps/web/src/app/(app)/tenant-admin/ai-plugins/page.tsx. Subtitle 'Enable, configure, and monitor machine learning models' (ai-plugins/page.tsx:74-77) but the page is a pure server component rendering read-only cards (:88-158); no client component, form, toggle or fetch to PATCH anywhere under tenant-admin/ai-plugins. Backend PATCH /v1/hrms/ai/plugins/:pluginId exists (services/hrms-service/src/modules/ai-ml/plugin-registry.ts:282) with zod body {enabled, mode: active|shadow|disabled, confidenceThreshold 0-100, notifyOnPrediction, autoAction, maxPredictionsPerDay}; grep of apps/web/src finds no other caller of 'ai/plugins'. Caveats in the backend: first PATCH for a plugin that omits notifyOnPrediction/autoAction/maxPredictionsPerDay inserts NULL into NOT NULL columns and 500s (comment at plugin-registry.ts:270-278), and the PATCH emits no audit event.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/ai-plugins/page.tsx`, `apps/web/src/app/(app)/tenant-admin/ai-plugins/PluginConfigControls.tsx (new)`, `services/hrms-service/src/modules/ai-ml/plugin-registry.ts`
- **Fix steps:**
  1. Backend first: change the INSERT in the PATCH handler (plugin-registry.ts:292) to supply defaults (COALESCE($7,false),$8 false,$9 1000) so a first PATCH does not 500, and emit an audit event (who/plugin/before-after) per CLAUDE.md audit rule.
  2. Create client component PluginConfigControls (props: pluginId, enabled, mode, confidenceThreshold, autoAction) with a mode <select> (active/shadow/disabled), enable switch and 0-100 threshold number input, validated with zod matching configUpdateSchema.
  3. Submit via existing /api/proxy/... route to PATCH /v1/hrms/ai/plugins/:pluginId; use useFormError + ConfirmDialog (requireReason for enabling autoAction) as in api-keys/APIKeyActions.tsx; router.refresh() on success.
  4. Render it inside each plugin card in page.tsx after the threshold bar; disable controls while busy and when requiresTraining && !enabled shows the existing warning.
  5. If the product decision is read-only, change subtitle to 'Monitor machine learning models' instead and skip steps 2-4.
- **Acceptance:**
  - Toggling a plugin to shadow mode calls PATCH with {mode:'shadow'}, badge changes to SHADOW after refresh.
  - First-ever PATCH with only {enabled:true} returns 200 (backend test) and writes an audit event.
  - Threshold input rejects 101 and -1 client-side; server 400 shown via useFormError.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Changes tenant-wide AI behaviour (autoAction can auto-shortlist candidates); needs role enforcement (-03) and audit before exposing controls.
- **Depends on:** GAP-TENANT-ADMIN-AI-PLUGINS-03

### GAP-TENANT-ADMIN-AI-PLUGINS-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Both fetches discard LoaderResult.source, so a failure renders zeros and an empty grid with no badge or error, identical to 'no plugins' (page.tsx:30-44,67).
- **Verified evidence:** getPlugins() and getSummary() (ai-plugins/page.tsx:30-44) return only r.data and drop LoaderResult.source; fetchJson yields empty [] / zero summary on any failure (apiClient.ts fetchJson 'no mock fallback', returns {data: empty, source:'error'}). Page therefore renders StatCards 0/0/0/0 and '—' (:80-84) and zero category sections (:88) with no DataSourceBadge or error state, identical to a tenant with no plugins (plugin list is static ML_PLUGINS on the server, so a healthy tenant always shows plugins - an empty grid always means failure).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/ai-plugins/page.tsx`
- **Fix steps:**
  1. Change getPlugins/getSummary to return the full LoaderResult and compute const state = combineResourceState([pluginsRes, summaryRes], plugins) from app/_data/useResource.ts.
  2. When state.status==='error' render <RefreshErrorState error={toHumanError('load',{area:'AI plugins'})} backHref='/tenant-admin' /> (as compliance/page.tsx:45) instead of grid.
  3. Pass '—' to StatCards value when either result errored; keep <DataSourceBadge> for partial failure.
  4. When ready but plugins.length===0 render <EmptyState> rather than blank.
- **Acceptance:**
  - Unit/RSC test: mock fetchJson to return source 'error' -> page shows RefreshErrorState and no '0' stat values.
  - Manual: stop hrms-service; page shows load-error state, not zeros.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentation only.
- **Depends on:** RefreshErrorState, combineResourceState

### GAP-TENANT-ADMIN-AI-PLUGINS-03  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Backend GET/PATCH under /v1/hrms/ai/plugins use resolveContext only — no role check — so any authenticated tenant user can read config and PATCH enable/auto_action for a tenant-admin feature (plugin-registry.ts:213,282).
- **Verified evidence:** Backend part confirmed: GET /v1/hrms/ai/plugins (plugin-registry.ts:213) and PATCH (:282) call only resolveContext(req); requireRole exists in services/hrms-service/src/shared/context.ts:30 but is not used in this file, so any authenticated tenant user (subject to gateway rules not in snapshot) can read config and PATCH enable/mode/autoAction. Web side is gated: tenant-admin/layout.tsx calls requireAnyRole(['tenant_admin','platform_admin','super_admin']), so only navigation is protected. The UI has no controls to hide today (see -01). Gateway-level role policy is cannot-verify (not in snapshot).
- **Files to change:** `services/hrms-service/src/modules/ai-ml/plugin-registry.ts`, `services/hrms-service/src/modules/ai-ml/plugin-registry.test.ts (new/extend)`
- **Fix steps:**
  1. In PATCH handler add requireRole(ctx,['tenant_admin','platform_admin','super_admin']) right after resolveContext (import from ../../shared/context.js).
  2. Decide GET: keep readable by HR roles if other modules consume it (no other web caller found) or apply the same requireRole to GET /plugins, /plugins/summary and /:pluginId/stats.
  3. Leave /:pluginId/feedback open to reviewing HR roles (requireRole with hr_admin, hr_officer, tenant_admin).
  4. Add route tests: non-admin gets 403 FORBIDDEN, admin gets 200.
- **Acceptance:**
  - PATCH with an employee-role JWT returns 403 'requires one of: ...'.
  - PATCH with tenant_admin JWT returns 200.
  - Existing GET tests still pass for admin.
- **Needs:** backend  ·  **Effort:** S ~half day  ·  **Risk:** Could break any non-admin HR caller of these endpoints if one exists in mobile or other apps (none in web snapshot); verify before tightening GET.
- **Depends on:** GAP-TENANT-ADMIN-AI-PLUGINS-01

### GAP-TENANT-ADMIN-AI-PLUGINS-04  ·  MEDIUM  ·  partly  ·  theme FORMAT (was CAP)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Avg Confidence uses a truthiness test, so a genuine 0 shows '—'; category heading replaces only the first underscore (page.tsx:84,92).
- **Verified evidence:** Line 84 uses `summary.avgConfidence7d ? `${..}%` : '—'` - a real numeric 0 would show '—' (confirmed, latent: postgres ROUND(numeric) usually reaches JS as a string like '0.0' which is truthy, so it rarely triggers). Line 92 `cat.replace('_',' ')` only replaces the first underscore (confirmed but latent: the only multi-word category in ML_PLUGINS is computer_vision, one underscore). The suggested fix (server-side pagination) does not apply: the plugin list is a static registry, not a capped fetch. Also the same truthiness pattern does not affect per-plugin stats, which use !== null (:116-123).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/ai-plugins/page.tsx`
- **Fix steps:**
  1. Line 84: use `summary.avgConfidence7d != null ? `${summary.avgConfidence7d}%` : '—'` (or Number.isFinite after Number()).
  2. Line 92: use `.replace(/_/g,' ')` or a shared humanizeCategory helper (formatters.humanizeStatus exists).
  3. Coerce numeric strings from the API (Number()) in the mapResponse so types match Plugin/Summary.
- **Acceptance:**
  - Test: avgConfidence7d = 0 renders '0%'; null renders '—'.
  - Test: category 'a_b_c' renders 'A B C'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Trivial.

### GAP-TENANT-ADMIN-AI-PLUGINS-05  ·  LOW  ·  partly  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Card text is 10px (text-[10px]) throughout and the threshold bar has no role/label; badges rely on colour + text (page.tsx:105,129-131).
- **Verified evidence:** Verified: text-[10px] at ai-plugins/page.tsx:105 (mode badge), :129 (threshold labels), :142 (data source), :148 (training warning); the bar (:133-138) is a plain div with no role/aria - confirmed. Badges do carry a text label (ACTIVE/SHADOW/OFF, :59-63) so 'rely on colour' is not accurate. Strings are hard-coded English, but next-intl is used only in a few shared components (DataTable, LanguageSwitcher); tenant-admin pages are not localised, so the i18n item is a broader decision. ds/ConfidenceBar.tsx exists (role='meter') but takes 0-1 values and colours by level.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/ai-plugins/page.tsx`
- **Fix steps:**
  1. Replace text-[10px] with text-xs (12px) on lines 105,129,142,148.
  2. Give the bar role='meter' aria-label={`Confidence threshold for ${plugin.name}`} aria-valuenow/min/max (0-100), or reuse ConfidenceBar with value={threshold/100} and a neutral colour prop.
  3. Add title/aria-label to emoji-only stat spans (:115-123) so screen readers get words, mark decorative emoji aria-hidden.
  4. Defer next-intl extraction to a suite-wide task.
- **Acceptance:**
  - axe run on /tenant-admin/ai-plugins reports no meter/progressbar-name violations.
  - Computed font-size of card labels >= 12px.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Minor layout reflow in cards.

### GAP-TENANT-ADMIN-AI-PLUGINS-06  ·  LOW  ·  partly  ·  theme LABEL (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Route is under tenant-admin but calls the hrms namespace (/api/v1/hrms/ai/plugins) — cross-module coupling; 'predictionsToday' is a rolling 24h window, not a calendar day (plugin-registry.ts:390).
- **Verified evidence:** Route is tenant-admin/ai-plugins/page.tsx calling /api/v1/hrms/ai/plugins and /plugins/summary (:31,:39) - cross-module coupling confirmed but it is the only place the registry lives (services/hrms-service/src/modules/ai-ml/plugin-registry.ts). 'predictionsToday' is `created_at > NOW() - INTERVAL '24 hours'` (plugin-registry.ts:390), i.e. rolling 24h, while the card label is 'Predictions Today' (page.tsx:82) - confirmed mislabel. Note plugin-registry.ts sits at lines 213/282/384; observation's :390 is correct.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/ai-plugins/page.tsx`, `services/hrms-service/src/modules/ai-ml/plugin-registry.ts`
- **Fix steps:**
  1. Rename StatCard label to 'Predictions (24h)' at page.tsx:82, or change SQL at plugin-registry.ts:390 to `created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata')` (converted back) for a true IST day.
  2. Record in code comment/ADR that AI plugin admin intentionally consumes the hrms namespace; no move needed unless a platform AI service is planned.
- **Acceptance:**
  - Label reads 'Predictions (24h)' (or SQL test shows a prediction at 23:00 IST yesterday excluded).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /tenant-admin/api-keys  —  `tenant-admin/api-keys.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/api-keys.html`

### GAP-TENANT-ADMIN-API-KEYS-01  ·  HIGH  ·  partly  ·  theme OTHER (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Revoke and Rotate buttons are listed only for active keys and open a reason-required ConfirmDialog — good — but the dialog is the only guard for rotate, which invalidates the live secret immediately with no grace/overlap window (APIKeyActions.tsx:219-221).
- **Verified evidence:** Checked api-keys/APIKeyActions.tsx: Rotate/Revoke are rendered only for activeKeys (:134,187-206) and open ConfirmDialog with requireReason (:215-231, reason sent in body at :102). Dialog copy (:220) states the old secret is invalidated immediately, so the UI itself confirms no overlap window; whether the backend supports a grace period is cannot-verify (identity service is not in the snapshot; proxied POST /api/proxy/identity/api-keys/:id/rotate). Secret is shown once in a plain <code> block with Copy button (:174-181) and never listed after (table shows keyPrefix**** only, APIKeysTable.tsx:41). Not a PII/masking issue; theme is a rotation-safety design question.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/api-keys/APIKeyActions.tsx`, `identity service rotate handler (not in snapshot)`
- **Fix steps:**
  1. Decision: agree whether rotate should support an overlap (e.g. old key valid N hours) - needs identity service change.
  2. If yes, add optional gracePeriodHours select (0, 1, 24, 72) to the rotate ConfirmDialog and send it in the POST body at APIKeyActions.tsx:102.
  3. Show old-key expiry time in the success message (:112).
  4. If no, keep behaviour and make the danger styling explicit: set danger={true} for rotate too (currently only revoke, :224).
- **Acceptance:**
  - Rotate with grace=24h leaves the old key authenticating for 24h and audit log records both events (backend test).
  - Rotate dialog cannot be confirmed without a reason.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Rotating a live key breaks the calling service immediately; any grace window widens the exposure of a possibly leaked key.

### GAP-TENANT-ADMIN-API-KEYS-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** KPI cards are not gated on source==='error' (siblings show '—'); a failed load prints 0/0/0/0 with a small badge (page.tsx:24-30).
- **Verified evidence:** api-keys/page.tsx:9 destructures {data, source}; StatCards (:25-28) use total/active/expired/neverUsed computed from keys=[] on failure -> 0/0/0/0; only a small DataSourceBadge is rendered at :30 after the grid. The table/actions below also show generic 'No records found' / 'No active keys to manage.' during an outage. Compliance page (compliance/page.tsx:37-45) shows the correct pattern.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/api-keys/page.tsx`
- **Fix steps:**
  1. Compute const state = toResourceState({data:keys,source}) (app/_data/useResource.ts).
  2. When error: StatCard values '—' and render <RefreshErrorState error={toHumanError('load',{area:'API keys'})} backHref='/tenant-admin' /> in place of the table/actions grid (:31-34).
  3. Keep the Create form available only when not errored (creating a key while list is unreadable is confusing).
- **Acceptance:**
  - Mock getAPIKeys source 'error' -> stat cards show '—' and RefreshErrorState is visible.
  - Healthy zero keys -> cards show 0 and empty message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-TENANT-ADMIN-API-KEYS-04  ·  MEDIUM  ·  partly  ·  theme SECURITY (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — Default scopes empty, zod validation, expiry select added; scopes still free-text, no catalogue multi-select
- **First-pass claim:** Scope is free text ('read:*' default); no expiry field on create although table shows Expires, and default scope grants read on every resource (APIKeyActions.tsx:15,153-163).
- **Verified evidence:** Confirmed: scopes is a free-text input defaulting to 'read:*' (APIKeyActions.tsx:15,153-163), validated client-side only by SCOPE_RE `^(\*|word):(\*|word)$` (:10,52); POST body is {name, scopes} only (:74) - no expiry field, yet the table has an 'Expires' column (APIKeysTable.tsx:47). Also inconsistent: hint/placeholder say resource:action (finance:read, audit:*) but the default 'read:*' reads as resource 'read', action '*'. What 'read:*' grants server-side is cannot-verify (identity service absent) so 'grants read on every resource' is unproven. No zod at the boundary on the client side beyond the regex.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/api-keys/APIKeyActions.tsx`, `identity service create-key schema (not in snapshot)`
- **Fix steps:**
  1. Change default scopes state to '' (force explicit choice) and fix placeholder to match the documented format.
  2. Replace free text with a multi-select/checkbox list of known scopes (fetch from identity scope catalogue if it exists, else a shared constant in packages/schemas).
  3. Add an Expiry select (30/90/365 days/custom date) sent as expiresAt (ISO) in the POST body at :74; confirm backend accepts it before shipping.
  4. Validate body with a shared zod schema before fetch.
- **Acceptance:**
  - Create form cannot submit with no scopes selected.
  - Created key appears in table with the chosen Expires date.
  - 'read:*' is not pre-filled.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Least-privilege change; wrong scope semantics could over- or under-grant service access.

### GAP-TENANT-ADMIN-API-KEYS-05  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Table and actions card have no empty state for zero keys; 'Expired' is rendered via StatusPill inactive while others use raw pill good/bad (APIKeysTable.tsx:51-54).
- **Verified evidence:** Empty state: not missing. APIKeysTable uses DataTable, which renders EmptyState with default 'No records found / There are no items to display yet.' when rows are empty (ds/DataTable.tsx:320) and the actions card shows 'No active keys to manage.' (APIKeyActions.tsx:185). What is missing is tailored copy/CTA (and on fetch error the same generic text appears, see -02). Status pills confirmed inconsistent: active/revoked use raw `<span className="pill good|bad">` and Expired uses <StatusPill status='inactive' label='Expired'> (APIKeysTable.tsx:51-54), although STATUS_MAP already has expired:'bad' and active:'good' (ds/StatusPill.tsx).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/api-keys/APIKeysTable.tsx`
- **Fix steps:**
  1. Replace the ternary at :51-54 with <StatusPill status={key.status} /> (active/expired/revoked); add 'revoked':'bad' to STATUS_MAP in ds/StatusPill.tsx if absent (it is not listed) and decide expired tone (bad vs mut).
  2. Pass emptyIcon/emptyTitle/emptyMessage to DataTable ('No API keys yet', 'Create your first key using Key Operations').
  3. Guard against filter yielding empty with a 'No keys match this filter' message.
- **Acceptance:**
  - Snapshot/component test: each status renders the same pill markup via StatusPill.
  - Zero keys shows the custom empty title.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-API-KEYS-06  ·  LOW  ·  partly  ·  theme DS (was WIRING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Create-form inputs use inline styles (inp/lbl) instead of DS .input; errors use hex colours (APIKeyActions.tsx:236-239).
- **Verified evidence:** Inline style objects lbl/inp/fieldErr/prefRow are defined at APIKeyActions.tsx:236-239 and used on the create form (:140-163) - confirmed. Hex colours: #b42318 (:238), #067647 (:171), #f8fafc (:176); the generic error at :213 uses var(--bad). But the suggested target is not available: civitas-ds.css defines no .input class (grep finds none; only ds/designer/SlabTableEditor.tsx uses className='input' with no matching CSS), and ds/ has no Input/FormField component. Theme WIRING is wrong.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/api-keys/APIKeyActions.tsx`, `apps/web/src/app/civitas-ds.css`, `apps/web/src/app/_components/ds/Input.tsx (new)`
- **Fix steps:**
  1. Add .input/.lbl/.field-err rules to civitas-ds.css using tokens (--line, --bad, --ink2) with a 44px min-height.
  2. Optionally create ds/Input + FormField wrapper (label, error, aria-describedby) and export from ds/index.ts.
  3. Swap the inline styles at :149,161 and lbl at :140,153; replace #b42318/#067647 with var(--bad)/var(--good).
  4. Reuse in other tenant-admin forms later.
- **Acceptance:**
  - No style={{...}} objects remain in APIKeyActions.
  - Dark-theme render keeps readable error/success colours.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Visual regression on form only.


---
## /tenant-admin/audit  —  `tenant-admin/audit.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/audit.html`

### GAP-TENANT-ADMIN-AUDIT-01  ·  HIGH  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W1 SF-07: re-confirmed on main 9e34d2e4a, rolling 24h via countLast24h in audit/page.tsx; table timestamps now formatIndianDateTime (IST) by #2017; originally closed by #1864)
- **First-pass claim:** 'Events (24h)' counts events whose UTC ISO date equals today's UTC date, not a rolling 24 hours and not IST; between 00:00–05:30 IST it shows the previous day's window (audit/page.tsx:12,17).
- **Verified evidence:** audit/page.tsx:12 `today = new Date().toISOString().slice(0,10)` (UTC date) and :17 counts events whose `timestamp.slice(0,10) === today` under the label 'Events (24h)' (:34). This is a UTC calendar day, neither rolling 24h nor IST; between 00:00-05:30 IST the UTC date is still the previous day. It also assumes timestamps are UTC ISO strings (a +05:30 offset string would compare on IST date). Rendering of the table time uses formatIndianDate (lib/formatters.ts:2) without an explicit timeZone, so display depends on browser TZ.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/audit/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Replace with rolling window: const cutoff = Date.now() - 24*3600*1000; count events where Date.parse(e.timestamp) >= cutoff (handle NaN).
  2. Prefer server-side count (see -04); at minimum keep this computation in one helper countLast24h(events, now).
  3. Pass timeZone:'Asia/Kolkata' in formatIndianDate/formatWhen (formatters.ts:6, AuditLogTable.tsx:24) so display is IST regardless of browser.
- **Acceptance:**
  - Unit test countLast24h with now=2026-01-01T01:00Z and events at 2025-12-31T23:00Z (counted) and 2025-12-30T23:00Z (not).
  - Event stamped 00:30 IST shows date/time in IST on any machine TZ.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Compliance screen; wrong count could understate activity.

### GAP-TENANT-ADMIN-AUDIT-02  ·  HIGH  ·  partly  ·  theme DEADCTL (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** The header 'Filter' is a PlaceholderButton with no behaviour, and the Export href on the home page (?export=true) is ignored — the two advertised controls for an audit screen are not functional beyond print (audit/page.tsx:28-29).
- **Verified evidence:** Filter: <PlaceholderButton label='Filter'> (audit/page.tsx:29) renders a disabled 'coming soon' Button (PlaceholderButton.tsx) - confirmed non-functional (though honest). Export: header 'Export' is PrintExportButton (:28) which calls window.print(), so it works but as browser print only; the home tenant-admin/page.tsx:30 links to /tenant-admin/audit?export=true, and audit/page.tsx never reads searchParams, so that param is ignored (confirmed). The table already has a working text filter (AuditLogTable.tsx:73 filterable) plus All/Failures segmented filter (:17,40). Theme PII/masking fix in the input does not apply. No CSV/audited export exists.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/audit/page.tsx`, `apps/web/src/app/(app)/tenant-admin/page.tsx`, `apps/web/src/app/_components/PlaceholderButton.tsx`
- **Fix steps:**
  1. Remove the PlaceholderButton (the DataTable search + Segmented already filter) or replace with real date-range/actor filters that pass query params to getTenantAuditLog.
  2. Change the home link at tenant-admin/page.tsx:30 to /tenant-admin/audit (drop ?export=true) or implement it by reading searchParams.export and triggering the export.
  3. If a real export is required: add server route that streams CSV, requires tenant_admin, and writes an audit event 'audit.exported'; wire via DataTable exportable.
- **Acceptance:**
  - No disabled 'Filter' button on the page.
  - Clicking home 'Export report' lands on audit page without a dead query param (or downloads a file if implemented).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Audit log exports contain actor emails/IPs (PII); any real export must be role-gated and logged.

### GAP-TENANT-ADMIN-AUDIT-03  ·  MEDIUM  ·  partly  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — Emails/IPs masked by default (maskEmail/maskIp); no reveal control or audit.viewed logging
- **First-pass claim:** DPDP: actor identifiers (emails) and source IPs are shown in clear to every role in the layout with no masking or view-audit; reading the audit log is itself not evidenced as audited (AuditLogTable.tsx:51-56).
- **Verified evidence:** Confirmed in UI: AuditLogTable.tsx:48-56 prints e.actor (email/identifier) and ipAddress in clear; page mapping at audit/page.tsx:41-49. Access to the page is limited by tenant-admin/layout.tsx requireAnyRole(tenant_admin, platform_admin, super_admin), so 'every role' is overstated; these are the roles entitled to see the audit log. No shared <Masked> component exists (grep finds none; only Step4 MaskedInput). Whether reads of the audit log are themselves audited is cannot-verify (audit service /api/v1/audit/events not in snapshot).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/audit/AuditLogTable.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`, `audit service (not in snapshot)`
- **Fix steps:**
  1. Decision: does DPDP policy require masking for tenant admins? If yes create ds/Masked (props value, kind 'email'|'ip', canReveal) that masks by default (a***@domain, 10.1.*.*) and reveals on click with an audit call.
  2. Use it for actor and ipAddress in AuditLogTable.tsx:54-55.
  3. Ask audit service owner to log 'audit.viewed' server-side (query params, actor).
- **Acceptance:**
  - Actor email shown masked by default; reveal requires click and posts an audit event.
  - Backend records view event when GET /audit/events is called.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Over-masking hurts investigation use; masking must not alter exported evidence.

### GAP-TENANT-ADMIN-AUDIT-04  ·  MEDIUM  ·  partly  ·  theme CAP

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — KPI relabelled 'Loaded events'; no server-side summary endpoint/cursor filters
- **First-pass claim:** KPIs are computed client-side from whatever the list endpoint returns (no total/count from API), so 'Total Events' equals the returned page size, not the tenant's history (audit/page.tsx:14-17).
- **Verified evidence:** Confirmed client-side: audit/page.tsx:14-17 derive Total/Success/Failure/24h from events.length of whatever getTenantAuditLog returns (loaders.ts:4352 GET /api/v1/audit/events?tenantScoped=true, getArrayPayload discards any envelope such as total/next), and AuditLogTable paginates only client-side (pageSize=15, :75). Page-size cap and existence of a total field in the audit service are cannot-verify (service and @civitasone/types not in snapshot). The 'Failures' filter also runs only on the fetched subset.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/audit/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `audit service (not in snapshot)`
- **Fix steps:**
  1. Confirm audit API contract: limit/cursor params and summary/count endpoint (e.g. totals by outcome, last 24h).
  2. Add getTenantAuditSummary() loader with zod schema and call it in page.tsx; show '—' if unavailable rather than derived counts.
  3. Move filters (outcome, search, date) to query params handled server-side; drive table pagination with cursor.
  4. Label the currently-loaded count as 'Loaded events' until then.
- **Acceptance:**
  - With 500 events in DB and API cap 100, Total shows 500 (server) not 100.
  - Failures filter returns failures beyond the first page.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Misleading totals on an audit screen; low data risk.
- **Depends on:** GAP-TENANT-ADMIN-AUDIT-01

### GAP-TENANT-ADMIN-AUDIT-05  ·  LOW  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** No EmptyState for zero events; failed load shows 0s (page.tsx:39). Outcome other than success/failure falls to an untranslated info pill (AuditLogTable.tsx:68).
- **Verified evidence:** Failed load: page does render <DataSourceBadge source='error'> (audit/page.tsx:39) but stat cards still show 0 (:34-37) and the table shows the generic DataTable 'No records found' - so 'shows 0s' confirmed, 'no error' partly (small amber badge only). No custom empty state: DataTable default EmptyState appears for zero rows (ds/DataTable.tsx:320). Unknown outcome falls to <span className='pill info'>{e.outcome}</span> at AuditLogTable.tsx:68 - raw un-humanised value (confirmed).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/audit/page.tsx`, `apps/web/src/app/(app)/tenant-admin/audit/AuditLogTable.tsx`
- **Fix steps:**
  1. Use toResourceState in page.tsx; on error show RefreshErrorState and '—' in StatCards.
  2. Pass emptyTitle='No audit events yet' to DataTable.
  3. Replace the outcome ternary with <StatusPill status={e.outcome} /> (uses humanizeStatus fallback) or humanizeStatus(e.outcome) for the info pill.
- **Acceptance:**
  - Error state replaces table when fetch fails.
  - Outcome 'denied' renders 'Denied'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState


---
## /tenant-admin/breakglass  —  `tenant-admin/breakglass.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/breakglass.html`

### GAP-TENANT-ADMIN-BREAKGLASS-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Banner asserts 'SRE has been alerted' as a hard-coded string; nothing in the page verifies an alert was sent (breakglass/page.tsx:25).
- **Verified evidence:** apps/web/src/app/(app)/tenant-admin/breakglass/page.tsx:25 hard-codes 'SRE has been alerted.' inside the active-session banner; nothing in the page or the BreakglassSummary fields used (id, actor, actorEmail, reason, startedAt, endedAt, status - :46-54) confirms an alert. Whether the identity service alerts on break-glass is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/breakglass/page.tsx`
- **Fix steps:**
  1. Remove the sentence at page.tsx:25 (or render it only if the API returns alertedAt/notifiedAt).
  2. Change banner to state facts: '{n} active break-glass session(s). Review and close when no longer needed.'
- **Acceptance:**
  - Banner text no longer claims an alert unless API supplies notification status.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; removes a possibly false assurance on a security page.

### GAP-TENANT-ADMIN-BREAKGLASS-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** On fetch failure events=[] so activeNow=0 and the red active-session banner vanishes — a live emergency session becomes invisible during an outage (page.tsx:9-27).
- **Verified evidence:** apps/web/src/app/(app)/tenant-admin/breakglass/page.tsx:9-12,23-27: on fetch failure getBreakglassLog returns [] with source 'error' -> activeNow=0 -> the red banner is not rendered and stat cards show 0 (:40-43). The only signal is a small DataSourceBadge in header actions (:35). During an outage a live emergency session is invisible.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/breakglass/page.tsx`
- **Fix steps:**
  1. Use toResourceState; if error render a prominent role='alert' banner 'Cannot determine active break-glass sessions' plus RefreshErrorState instead of table.
  2. Stat cards value '—' when errored.
  3. Optionally add revalidate low (loader uses 30s) or no-store for this page since staleness also hides sessions.
- **Acceptance:**
  - Mock source 'error' -> alert banner shown, no '0' active count.
  - Healthy with 1 active -> red active banner as before.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Security visibility; low regression risk.
- **Depends on:** RefreshErrorState

### GAP-TENANT-ADMIN-BREAKGLASS-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Duration' column prints only 'Ended'/'Ongoing' — no elapsed time or expiry, though the detail page models duration and expiresAt (BreakglassTable.tsx:54).
- **Verified evidence:** Confirmed: BreakglassTable.tsx:54 Duration cell prints only 'Ended'/'Ongoing' based on endedAt. startedAt and endedAt are available on every row, so elapsed time is computable client-side; an expiresAt field is not among the fields the page passes (page.tsx:46-54) and its existence in the API is cannot-verify (the detail page's expiresAt is fabricated sample data). Note status can also be 'auto_expired' (type at :15) which this cell shows as 'Ongoing' if endedAt is absent - a wrong label.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/breakglass/BreakglassTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatDuration(startedAt, endedAt?, now) helper to lib/formatters.ts (e.g. '2h 15m', 'ongoing 45m').
  2. Render `event.status==='active' ? 'Ongoing - ' + elapsed : formatDuration(...)`; for auto_expired show 'Auto-expired'.
  3. Show expiresAt if the API provides it (confirm with identity team).
- **Acceptance:**
  - Row with start 10:00 end 12:15 shows '2h 15m'.
  - auto_expired row does not show 'Ongoing'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-BREAKGLASS-04  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Requester rows have no link to /tenant-admin/breakglass/[id]; the detail route is unreachable from the list (BreakglassTable.tsx:38-71).
- **Verified evidence:** Duplicate of DETAIL-02: BreakglassTable.tsx:38-71 has no link to /tenant-admin/breakglass/[id]. Additionally the target page currently shows fake data so linking is unsafe until DETAIL-01 is done.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/breakglass/BreakglassTable.tsx`
- **Fix steps:**
  1. Add next/link on the Requester name after DETAIL-01 ships.
  2. Track under DETAIL-02 to avoid two fixes.
- **Acceptance:**
  - See DETAIL-02.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Same as DETAIL-02.
- **Depends on:** GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-01, GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-02

### GAP-TENANT-ADMIN-BREAKGLASS-05  ·  MEDIUM  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Close session is offered to every allowed role, including the requester if they hold tenant_admin — no separation-of-duties gate; reason is required and audited (BreakglassActions.tsx:40,54).
- **Verified evidence:** Confirmed: BreakglassTable.tsx:68-69 shows BreakglassActions for every active row and BreakglassActions.tsx:40 offers 'Close session' with no current-user comparison (only `requester` name used for dialog text, :48); reason is required (:54, requireReason) and sent (:23). The tenant-admin layout allows tenant_admin/platform_admin/super_admin. Overstated: closing (revoking) emergency access is a risk-reducing action, so a requester closing their own session is normally acceptable; separation-of-duties matters for grant/approval, which this UI does not show. Server-side enforcement and audit of /break-glass/:id/close are cannot-verify (identity service absent).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/breakglass/BreakglassActions.tsx`
- **Fix steps:**
  1. Decision: confirm policy (requester may self-close?).
  2. If required, pass currentUserId into BreakglassTable and hide/disable the button when requesterId===currentUserId, with tooltip; enforce the same rule in identity service.
  3. Otherwise close as no-change and document.
- **Acceptance:**
  - If SoD enabled: requester sees disabled button with explanation; another admin can close.
  - Server returns 403 on self-close.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Blocking self-close could leave an emergency session open if no other admin is available.


---
## /tenant-admin/breakglass/[id]  —  `tenant-admin/breakglass-detail.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/breakglass-detail.html`

### GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** The page renders a hard-coded sample record for every id and makes no fetch; the breadcrumb says 'Event <any-id>' but the body is always Vikram Singh's Jan 2025 incident — misleading on an audit/security screen (page.tsx:17-37,48-57).
- **Verified evidence:** apps/web/src/app/(app)/tenant-admin/breakglass/[id]/page.tsx:17-37 defines a module-level const breakglassEvent (Vikram Singh, vikram.singh@civitas.gov.in, 2025-01-15, vault/k8s resources, approval chain) and the component (:48-104) renders it for any params.id with no fetch, no notFound, no 'sample' label; only the breadcrumb (:51) echoes the id. No detail endpoint is referenced anywhere in the web code (list loader uses /api/v1/admin/breakglass only, loaders.ts:4325). Whether identity service exposes GET /admin/breakglass/:id and fields (duration, resourcesAccessed, approvalChain) is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/breakglass/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `identity service (not in snapshot)`
- **Fix steps:**
  1. Immediate: delete the hard-coded object; make the page async and call new getBreakglassEvent(id) loader (fetchJson to /api/v1/admin/breakglass/:id with zod schema).
  2. Use LoaderResult.status: 404 -> notFound(); other errors -> <RefreshErrorState>.
  3. Render only fields the API returns (initiator, reason, startedAt, endedAt, status, closedBy, closeReason); hide Resources/Approval cards when absent instead of inventing them.
  4. If no endpoint will exist, delete the route directory and its links (see -02).
- **Acceptance:**
  - GET /tenant-admin/breakglass/does-not-exist returns 404 page.
  - Detail for a real id shows that event's initiator and reason, never 'Vikram Singh'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Security screen showing false evidence; must not ship as-is.
- **Depends on:** GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-02

### GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** No route from the list (BreakglassTable rows have no link) and no not-found handling, so the detail is both unreachable and untrustworthy (breakglass/BreakglassTable.tsx:38-71).
- **Verified evidence:** BreakglassTable.tsx:38-71 has no <Link>/href on any cell (Requester cell :42-50 is plain text; Actions cell only renders BreakglassActions or '—'); grep for 'breakglass/' across apps/web/src finds only the route's own files and its breadcrumb. Detail page has no notFound handling (BD:48-104), though error.tsx and loading.tsx exist beside it.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/breakglass/BreakglassTable.tsx`, `apps/web/src/app/(app)/tenant-admin/breakglass/[id]/page.tsx`
- **Fix steps:**
  1. Wrap the requester name in next/link to `/tenant-admin/breakglass/${event.id}` in BreakglassTable.tsx:45-47 (only once -01 is fixed to show real data).
  2. Add notFound() handling in the detail page for status 404.
  3. Alternatively remove the route until an endpoint exists.
- **Acceptance:**
  - Clicking a requester opens the matching event detail.
  - Unknown id shows not-found.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Do not link before -01, else users reach fake data.
- **Depends on:** GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-01

### GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — Resources/approval render only if API supplies; server-side breakglass.viewed audit not verifiable (backend).
- **First-pass claim:** Resource strings (vault:secrets/…, k8s pod logs) would be sensitive if real; no role gate beyond the layout and no audit of the view (page.tsx:25-30).
- **Verified evidence:** Resource strings are hard-coded sample text (BD:25-30) and would be sensitive only if real. Route is behind tenant-admin/layout.tsx requireAnyRole; per-view auditing cannot be verified (no data fetch exists, identity/audit services absent). Becomes moot when -01 removes the sample; the real concern is what the future API returns.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/breakglass/[id]/page.tsx`
- **Fix steps:**
  1. When binding real data, render resource identifiers as labels only (system name + access type), never secret paths/values.
  2. Request server-side 'breakglass.viewed' audit event on the detail endpoint.
  3. Reuse ds Masked once created (see AUDIT-03) for any credential-like strings.
- **Acceptance:**
  - Detail response contains no secret material.
  - Audit log shows a view event per detail request.
- **Needs:** backend  ·  **Effort:** S ~half day  ·  **Risk:** Low now (fake data).
- **Depends on:** GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-01, GAP-TENANT-ADMIN-AUDIT-03

### GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Sample email uses @civitas.gov.in and dates from 2025 — placeholder data will read as real to a reviewer (page.tsx:20-24).
- **Verified evidence:** apps/web/src/app/(app)/tenant-admin/breakglass/[id]/page.tsx:20-24 uses vikram.singh@civitas.gov.in and 2025-01-15 timestamps in the hard-coded record, presented as real with no 'sample' marker. Same root cause as -01.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/breakglass/[id]/page.tsx`
- **Fix steps:**
  1. Resolved by removing the object (see -01).
  2. If a sample is needed for design review only, gate it behind NODE_ENV!=='production' with a visible 'Sample data' banner and example.com email.
- **Acceptance:**
  - No @civitas.gov.in address or 2025 timestamp in the shipped bundle (grep check).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-01

### GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-05  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Status 'expired' and approval decisions map through StatusPill guesses ('completed' for Acknowledged) (page.tsx:97).
- **Verified evidence:** apps/web/src/app/(app)/tenant-admin/breakglass/[id]/page.tsx:97 maps decision via nested ternary: 'approved'->approved, 'initiated'->active, anything else (Acknowledged) -> 'completed'; and status 'expired' relies on StatusPill STATUS_MAP expired:'bad' (ds/StatusPill.tsx). So Acknowledged shows a green 'completed' pill but the label overrides the text. Guess-mapping confirmed; it applies to hard-coded data only.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/breakglass/[id]/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add 'acknowledged':'info' and 'initiated':'info' to STATUS_MAP in StatusPill.tsx.
  2. Replace the ternary with <StatusPill status={step.decision} />.
  3. Align status values with the API enum (active|ended|auto_expired per BreakglassTable.tsx:15), not 'expired'.
- **Acceptance:**
  - Acknowledged renders neutral/info tone with its own label.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-01


---
## /tenant-admin/compliance  —  `tenant-admin/compliance.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/compliance.html`

### GAP-TENANT-ADMIN-COMPLIANCE-01  ·  MEDIUM  ·  partly  ·  theme A11Y (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Result is conveyed by emoji plus coloured text (#16a34a/#d97706/#dc2626 hex) — amber text on white is below 4.5:1 and 'fail' never links to remediation or the failing resource (page.tsx:8-19,63).
- **Verified evidence:** Lines 8-18 map result to hex colours (#16a34a pass, #d97706 warn, #dc2626 fail) and emoji; line 63 renders the result as coloured text. Contrast: #d97706 on white is about 3.2:1 (fails 4.5:1 for 12px text) - confirmed; #16a34a about 3.3:1 also fails - understated. Not colour-only: the text word (Pass/Warn/Fail) and emoji are both shown (:56,63). 'fail' cannot link to remediation because ComplianceCheck has only id, timestamp, title, result (loaders.ts ComplianceCheck) - no resource or href field; adding one is a backend change.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/compliance/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Replace resultColor/resultIcon and the inline span at :63 with <StatusPill status={check.result} /> (add pass->good, warn->warn, fail->bad to STATUS_MAP; 'passed'/'failed' exist already) to get token-based, contrast-checked colours.
  2. Keep icons aria-hidden (already).
  3. If API adds remediationUrl/resource, render a 'View' link on warn/fail rows; extend ComplianceCheck type in @civitasone/types.
- **Acceptance:**
  - axe reports no color-contrast issue on check results.
  - Fail rows show a link when remediationUrl present.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-COMPLIANCE-03  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Fallback loader yields retentionStatus 'Unknown' and 0% scores; only the errored branch hides them, so an empty-but-successful response shows '0%' DPDP (loaders.ts getComplianceOverview).
- **Verified evidence:** getComplianceOverview (loaders.ts ~4741) returns the zero fallback {dpdpScore:0,certInReadiness:0,retentionStatus:'Unknown',checks:[]} only when the fetch fails, and compliance/page.tsx:24,37-40 already replaces those with '—' when resource.status==='error' and shows RefreshErrorState (:43-46) - so the described failure case is handled. The real gap: no responseSchema, mapResponse accepts any record (`isRecord(p) ? p as ComplianceOverview`), so a 200 with missing fields renders 'undefined%' and `overview.checks.filter` would throw (page crash to error.tsx). A genuine 0 from the API shows '0%' correctly. toResourceState treats checks.length===0 as 'empty' but the KPIs still render as if data exist.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/compliance/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `packages/schemas (web schemas, not in snapshot)`
- **Fix steps:**
  1. Add ComplianceOverviewSchema (zod: dpdpScore number 0-100, certInReadiness number, retentionStatus string, checks array) and pass as responseSchema in getComplianceOverview so malformed payloads become source 'error'.
  2. In page.tsx show '—' for KPIs when status is 'empty' and scores are null (make fields nullable in schema).
  3. Add test for a 200 body {} -> error state.
- **Acceptance:**
  - Body {} yields RefreshErrorState not 'undefined%'.
  - Body with dpdpScore 0 shows '0%'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-COMPLIANCE-04  ·  LOW  ·  partly  ·  theme POLISH (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — DataSourceBadge dropped (single error msg); timeline still unpaginated <ol> with inline styles.
- **First-pass claim:** DataSourceBadge rendered unconditionally above KPIs (null when healthy); timeline is a list with inline styles, no table for many checks (page.tsx:34,52).
- **Verified evidence:** Line 34 renders <DataSourceBadge source={result.source}/> unconditionally; it returns null when source!=='error' (DataSourceBadge.tsx), so healthy pages are unaffected - not a defect, but on error the badge and RefreshErrorState (:45) show two messages. Timeline (:53-68) is an <ol> with inline styles and no pagination/filter; adequate for a short list, a limitation for many checks (confirmed, minor).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/compliance/page.tsx`
- **Fix steps:**
  1. Render DataSourceBadge only when not errored or drop it since RefreshErrorState covers error.
  2. If checks can exceed ~20, switch to DataTable with sort/filter and pageSize; move inline styles to a class.
- **Acceptance:**
  - On error only one error message is visible.
  - 30 checks paginate.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /tenant-admin/data-export  —  `tenant-admin/data-export.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/data-export.html`

### GAP-TENANT-ADMIN-DATA-EXPORT-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** handleSubmit never checks the POST response: any failure still inserts a 'Processing' row (id Date.now()), so the user believes an export is running (DataExportClient.tsx:45-63).
- **Verified evidence:** apps/web/src/app/(app)/tenant-admin/data-export/DataExportClient.tsx:45-66: fetch(POST /api/proxy/v1/admin/data-exports).then(() => setExports([{id:String(Date.now()), status:'processing',...}, ...prev])).finally(...). The .then callback never reads res.ok and there is no .catch, so a 4xx/5xx still adds a fake 'Processing' row (a network error adds no row but is silently swallowed and leaves an unhandled rejection). The client id is never reconciled with a server id. Backend endpoint /api/v1/admin/data-exports is not in this snapshot (only the loader at _data/loaders.ts:4651 references it).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/data-export/DataExportClient.tsx`
- **Fix steps:**
  1. Rewrite handleSubmit as async with try/catch/finally; await fetch and check res.ok.
  2. On !res.ok or exception show an inline error via the app's formError helper (as used in tenant-admin/users/[id]/UserSecurityActions.tsx: formError.fromResponse / fromException) in an aria-live region; do not touch the exports list.
  3. On success parse the 202 body (DataExportRequest) and prepend that; if body lacks id, call router.refresh() instead of inventing a Date.now() id.
  4. Keep submitting=true until the request settles; disable the button while in flight (already done).
  5. Remove the void fetch pattern.
- **Acceptance:**
  - Component test: mock fetch to return 500 -> no new row in Past Exports and an error message is announced.
  - Component test: mock fetch to return 202 with body -> row appears with server id and status.
  - Manual: block the request in devtools -> error shown, list unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; only changes failure path. Confirm actual 202 response shape with backend before parsing.
- **Depends on:** shared checked-fetch/formError helper

### GAP-TENANT-ADMIN-DATA-EXPORT-02  ·  HIGH  ·  confirmed  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — ConfirmDialog with required purpose (min 10) sent in body done; page.tsx role gate not narrowed.
- **First-pass claim:** A tenant-wide 'Full Export' of all modules (incl. payroll, HRMS personal data) is one click with no confirmation, purpose/reason field, or role narrower than the layout; export of personal data should be a reasoned, audited action (DataExportClient.tsx:78-106).
- **Verified evidence:** DataExportClient.tsx:76-113: the form submits directly on the 'Export' button (line 108) with default type 'full' (line 39); no ConfirmDialog, no reason/purpose field, and the request body (line 53) carries only type/moduleFilter/format. Page access is only the tenant-admin layout guard (layout.tsx:4 allows tenant_admin, platform_admin, super_admin). The MODULES list (line 13) includes payroll and hrms. Whether the server emits an audit event / enforces stricter roles cannot be seen (backend absent).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/data-export/DataExportClient.tsx`, `apps/web/src/app/(app)/tenant-admin/data-export/page.tsx`
- **Fix steps:**
  1. Replace direct submit with ConfirmDialog (apps/web/src/app/_components/ds/ConfirmDialog.tsx) using requireReason, minReasonLength (e.g. 10), danger, and a description naming the scope (Full / module) and that personal data is included.
  2. Send the reason in the POST body (field name to be agreed with backend, e.g. purpose) and surface errorMessage/busy from the dialog.
  3. In page.tsx, gate the page (or the Full/payroll/hrms options) with requireAnyRole to a narrower set agreed with the product owner, mirroring operations/page.tsx:47.
  4. Agree with backend that POST data-exports emits an audit event with actor, scope, purpose (CLAUDE.md rule 8) - track as a backend dependency.
- **Acceptance:**
  - Component test: clicking Export opens the dialog; Confirm stays disabled until reason >= min length; POST body includes reason.
  - Manual: a user without the narrower role cannot reach the page or the Full option.
  - Backend: audit event exists for each export request (verify in audit log).
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Personal-data egress (payroll/HRMS); role decision needs owner sign-off. Server-side enforcement must not rely on the UI.
- **Depends on:** GAP-TENANT-ADMIN-DATA-EXPORT-01

### GAP-TENANT-ADMIN-DATA-EXPORT-03  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Single Entity' type offers no entity selector, so the request cannot say which entity; and the Download button has no href/handler in code (DataExportClient.tsx:85,141-143).
- **Verified evidence:** DataExportClient.tsx:85 offers <option value="entity">Single Entity</option>, but the form renders only a Module select for type==='module' (lines 89-97); the POST body (line 53) has no entity field, so an 'entity' request is unspecified. The Download Button at line 141 has no onClick and is not an anchor with href; DataExportRequest (loaders) contains no download URL that could be used - a download endpoint is not visible in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/data-export/DataExportClient.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Either remove the 'Single Entity' option or add an entity selector/id input plus a body field; confirm the accepted shape with the backend before adding it.
  2. Wire the Download button: render <a href={`/api/proxy/v1/admin/data-exports/${exp.id}/download`}> (confirm the real download route with backend) styled as a small Button, or fetch a signed URL then window.location.
  3. If no download endpoint exists yet, render the Ready state as disabled with 'Download unavailable' rather than an inert active button.
  4. Extend DataExportRequest type only with fields the API really returns (e.g. downloadUrl) after checking.
- **Acceptance:**
  - Component test: a ready row exposes a link/button that triggers navigation to the download route.
  - Component test: selecting a type never yields a request that lacks required parameters (entity option removed or requires an id).
  - Manual: download of a ready export returns a file.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Download must be authenticated and audited on the server; do not expose raw storage URLs. Endpoint contract is unverified.
- **Depends on:** GAP-TENANT-ADMIN-DATA-EXPORT-01

### GAP-TENANT-ADMIN-DATA-EXPORT-04  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Copy frames the org admin as the DPDP data principal ('you have the right to export your data'); '~2 min' is hard-coded and the aria-label on Download embeds a raw ISO timestamp (DataExportClient.tsx:141; page.tsx:20-22).
- **Verified evidence:** data-export/page.tsx:16 subtitle and 18-23 notice ('you have the right to export your data') frame the org admin as data principal; a tenant admin exporting tenant data is a fiduciary/processor action, not a data-principal right request. '48 hours' is hard-coded (line 21). DataExportClient.tsx:143 hard-codes '~2 min'; line 141 aria-label is `Download export from ${exp.createdAt}` = raw ISO string. Panel also uses inline hex (#eff6ff, #1e40af) at lines 18-20.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/data-export/page.tsx`, `apps/web/src/app/(app)/tenant-admin/data-export/DataExportClient.tsx`
- **Fix steps:**
  1. Reword the notice (legal to approve): describe that the organisation can export its data held in CivitasOne, mention retention; drop 'you have the right'.
  2. Derive the availability window from exp.expiresAt when present, else omit the hours claim rather than hard-coding 48.
  3. Replace '~2 min' with 'Processing' (no estimate) unless the API provides one.
  4. Change aria-label to use the formatted date (formatIndianDate from apps/web/src/lib/formatters.ts) plus type and format.
  5. Use a token-based notice class instead of inline hex.
- **Acceptance:**
  - Component test: Download button aria-label contains a readable date, not an ISO string.
  - Copy reviewed by legal/DPO.
  - Notice renders correctly in dark mode.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Legal wording under DPDP Act; must be approved before change.

### GAP-TENANT-ADMIN-DATA-EXPORT-05  ·  LOW  ·  partly  ·  theme RESPONSIVE (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Status pill colours are inline hex, table is a bare .data-table without mobile transform, and the 4-column form grid is fixed (1fr 1fr 1fr auto) with no responsive collapse (DataExportClient.tsx:22-34,79).
- **Verified evidence:** True: status pill colours are inline hex (DataExportClient.tsx:23-29, applied via style at 31); the form grid is fixed 'gridTemplateColumns: 1fr 1fr 1fr auto' (line 79) with no media query, and it includes a 4th column only when module is selected, so with 'module' hidden the grid leaves an empty cell. Table uses plain className data-table (line 120). Not verifiable: whether .data-table has a mobile transform - no CSS defining it is in the snapshot's apps/web/src (civitas-ds.css does not mention data-table).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/data-export/DataExportClient.tsx`
- **Fix steps:**
  1. Replace statusBadge with shared StatusPill (apps/web/src/app/_components/ds/StatusPill.tsx); add pending/processing/ready keys to STATUS_MAP if tones are missing (ready->good, processing->warn, failed->bad, expired->mut already map partly).
  2. Change form grid to repeat(auto-fit, minmax(180px, 1fr)) or a className with a media query.
  3. Use the shared DataTable (with responsive behaviour) or wrap the table in an overflow-x container until the mobile pattern is confirmed.
- **Acceptance:**
  - Visual check at 360px width: form fields stack, table scrolls or stacks with no horizontal page scroll.
  - Status pills follow theme in dark mode.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low, presentational.


---
## /tenant-admin/domain  —  `tenant-admin/domain.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/domain.html`

### GAP-TENANT-ADMIN-DOMAIN-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 closed by #1864; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: delete goes through ConfirmDialog with required reason)
- **First-pass claim:** Delete removes the domain immediately — no ConfirmDialog, no audit reason — and the request is fire-and-forget; it is a destructive change to production login URLs (DomainClient.tsx:69-72).
- **Verified evidence:** apps/web/src/app/(app)/tenant-admin/domain/DomainClient.tsx:69-72: handleDelete fires void fetch(DELETE /api/v1/admin/custom-domains/${id}) and immediately filters the row from state without checking the response or asking for confirmation; the trash button at line 116 calls it directly. ConfirmDialog with requireReason exists (_components/ds/ConfirmDialog.tsx:21-56) but is unused here. Also uses /api/v1/... rather than /api/proxy/v1/... (13 client fetches use this pattern vs 352 with /api/proxy); no Next route for it is in the snapshot, next.config is absent - cannot verify the gateway rewrite.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/domain/DomainClient.tsx`
- **Fix steps:**
  1. Add state pendingDelete: CustomDomain|null; the trash button sets it instead of deleting.
  2. Render <ConfirmDialog danger requireReason minReasonLength={5} title="Remove domain" description={domain name + note that login URLs stop working}/> from ds.
  3. On confirm: await fetch DELETE (send reason as JSON body or header per backend contract), check res.ok, only then remove the row; show errorMessage on failure and keep row.
  4. Switch URL to /api/proxy/v1/admin/custom-domains/... consistent with other clients after confirming the route.
  5. Backend: DELETE must emit an audit event with the reason (CLAUDE.md rule 8).
- **Acceptance:**
  - Component test: clicking the trash icon opens the dialog and does not call fetch.
  - Component test: confirm with reason calls DELETE once; on 500 the row remains and an error shows.
  - Backend: audit event with actor and reason recorded.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Removing an active domain breaks tenant login URLs; maker-checker beyond reason is a product decision.
- **Depends on:** ConfirmDialog, GAP-TENANT-ADMIN-DOMAIN-04

### GAP-TENANT-ADMIN-DOMAIN-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 closed by #1864; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: a failed POST adds no row (DomainClient.test covers it))
- **First-pass claim:** When POST /custom-domains fails, the catch-all 'optimistic' branch still adds the domain locally as pending_verification with a client-made token; the user can then follow DNS instructions for a record the server never issued (DomainClient.tsx:50-58).
- **Verified evidence:** DomainClient.tsx:37-62 handleAddDomain: on !res.ok (lines 49-58) it creates id=crypto.randomUUID(), token `civitasone-verify-<12 chars>` and appends the domain as pending_verification; the DNS modal (lines 151-183) then shows that client-generated token (line 161) as the TXT value. There is no .catch, so a thrown network error adds nothing but the modal is already closed and newDomain cleared (lines 60-61). Any non-2xx (400 invalid domain, 409 duplicate, 403) triggers the fake record. Also note the fetch targets /api/v1/... not the proxy, so unless a gateway rewrite exists (unverifiable) it would always 404 into this branch.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/domain/DomainClient.tsx`
- **Fix steps:**
  1. Make handleAddDomain async; on !res.ok do NOT add a row - read the error via formError.fromResponse and show it inside the Add modal (keep it open, keep input).
  2. On success append the server-returned CustomDomain (already done) and optionally open the DNS instructions for it.
  3. Add try/catch for network errors with the same inline message; close modal and clear input only on success.
  4. Delete the client-side token generation entirely.
  5. Confirm the request path (proxy vs direct) with the gateway config.
- **Acceptance:**
  - Component test: POST returns 409 -> no row added, error visible, modal open.
  - Component test: POST 201 -> row from response body shown with server token.
  - Manual: with backend down, no DNS instructions are ever displayed for an unsaved domain.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Prevents admins configuring DNS for records that do not exist; low regression risk.
- **Depends on:** GAP-TENANT-ADMIN-DATA-EXPORT-01

### GAP-TENANT-ADMIN-DOMAIN-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 closed by #1864; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: verify no longer flips the row before the server answers)
- **First-pass claim:** handleVerify flips the row to 'verified' before the server answers and ignores the result; a failed verification looks successful (DomainClient.tsx:64-67).
- **Verified evidence:** DomainClient.tsx:64-67: handleVerify calls void fetch(POST .../verify) and synchronously sets status 'verified' on the row; the response (which may be failed/pending DNS) is ignored, and there is no busy state. The status union in loaders.ts:4711 includes 'failed', which is never produced here.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/domain/DomainClient.tsx`
- **Fix steps:**
  1. Make handleVerify async with a per-row busy id state; disable that Verify button while awaiting.
  2. await fetch; if !res.ok show a row/toast error and leave status unchanged.
  3. On ok, replace the row with the returned CustomDomain if the body has one, else router.refresh(); never set 'verified' locally.
  4. Announce result via an aria-live region.
- **Acceptance:**
  - Component test: verify returns 422 -> status stays 'Pending Verification' and message appears.
  - Component test: verify returns updated domain -> pill reflects server status.
  - Manual: DNS not propagated -> UI does not show Verified.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; response body shape of verify endpoint is unverified.
- **Depends on:** GAP-TENANT-ADMIN-DOMAIN-02

### GAP-TENANT-ADMIN-DOMAIN-04  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was FABRICATED)

- [x] **Status** (W1 SF-19: closed by #2014; earlier W0 tick #1864 re-confirmed against 9e34d2e4a: Remove button has aria-label; the Add and DNS modals were hand-rolled role=dialog with hard-coded colours and no focus trap, now ds/Modal (theme tokens, Escape, focus return))
- **First-pass claim:** Delete button is icon-only (🗑️) with no aria-label; modals use hard-coded white background and hex colours so they break in dark mode (DomainClient.tsx:116,127-128,152-153).
- **Verified evidence:** DomainClient.tsx:116 delete is <button className="btn btn-sm">🗑️</button> with no aria-label/title (the comment at lines 112-115 acknowledges it). Both modals set style background:'#fff' (lines 128 and 153) with inline hex text colours (#666 at 103/155, #f1f5f9 code block at 156, #dc2626 at 116), which override theme tokens in dark mode. Modals also lack focus trap/Escape handling that ConfirmDialog has (FOCUSABLE handling in _components/ds/ConfirmDialog.tsx). Not a 'fabricated' issue - the tag is wrong.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/domain/DomainClient.tsx`
- **Fix steps:**
  1. Add aria-label={`Remove ${d.domain}`} and title to the icon button (use ds Button variant/danger if available).
  2. Remove inline background:'#fff' and hex colours from modal-content; use CSS variables (var(--bg), var(--ink2), var(--border)) or an existing modal class.
  3. Replace hand-rolled overlays with a shared Modal/Dialog component if one exists (otherwise reuse ConfirmDialog's focus trap pattern) for Escape and focus return.
  4. Give code block a token background.
- **Acceptance:**
  - Component test: getByRole('button',{name:/Remove erp.example.gov.in/}) exists.
  - Visual check in dark mode: modal background and text are legible and themed.
  - Keyboard: Escape closes DNS modal and focus returns to trigger.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; presentational/a11y.
- **Depends on:** GAP-TENANT-ADMIN-DOMAIN-01

### GAP-TENANT-ADMIN-DOMAIN-06  ·  LOW  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** 'White-Label' is in the title but the page has no branding controls (colours/logo live elsewhere: settings/branding).
- **Verified evidence:** domain/page.tsx:16 title 'Custom Domain & White-Label', subtitle 'Configure custom domains and branding'. The page (page.tsx + DomainClient.tsx) has only domain registration, verification and DNS instructions - no colour/logo controls. Branding UI exists at apps/web/src/app/(app)/settings/branding/page.tsx (and (app)/themes/branding).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/domain/page.tsx`
- **Fix steps:**
  1. Rename title to 'Custom Domains' and subtitle to 'Register and verify custom domains for your organisation's login and portal URLs.'
  2. Optionally add a link 'Manage branding' to /settings/branding in PageHeader actions.
  3. Update any nav/breadcrumb/help text that says White-Label.
- **Acceptance:**
  - Page title no longer promises white-label; a link to /settings/branding resolves (200).
  - Strings reviewed by product owner.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None; copy only.


---
## /tenant-admin/idp  —  `tenant-admin/idp.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/idp.html`

### GAP-TENANT-ADMIN-IDP-01  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Last Sync' KPI is the hard-coded word 'Recent' whenever any provider exists, regardless of actual lastSync — it cannot signal a stale directory (idp/page.tsx:37).
- **Verified evidence:** apps/web/src/app/(app)/tenant-admin/idp/page.tsx:37: value={errored ? "—" : providers.length > 0 ? "Recent" : "—"}; IdpProviderSummary (_data/loaders.ts:4690-4698) carries lastSync: string per provider, which is never consulted, so an out-of-date directory sync still reads 'Recent'.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/idp/page.tsx`
- **Fix steps:**
  1. Compute the most recent valid lastSync (Date.parse, ignore NaN) across active providers, and the oldest one.
  2. Show the oldest active provider's lastSync as relative/absolute IST date (formatIndianDate from lib/formatters.ts or a new formatDateTimeIST helper) or '—' if none.
  3. Add a warn hint/sub-label when oldest sync is older than a threshold (e.g. 24h; threshold is a product decision).
  4. Keep errored path as '—'.
- **Acceptance:**
  - Unit test: providers with lastSync 3 days ago -> KPI shows that date/stale hint, not 'Recent'.
  - Unit test: no valid lastSync -> '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-IDP-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Add Provider links to /tenant-admin/sso, i.e. the SSO list, not a create form; there is no way to edit, test-connection, disable or delete a provider on this page (page.tsx:23-25).
- **Verified evidence:** idp/page.tsx:23-25 and 50 link 'Add Provider' to /tenant-admin/sso; sso/page.tsx:24 and 46 link 'Configure Identity Provider'/'Configure IDP' back to /tenant-admin/idp - a circular pair with no create form on either. IdpTable.tsx:19-35 has columns only (no actions column, no rowHref); no edit/test/disable/delete UI exists in tenant-admin/idp or sso directories (idp has only IdpTable, error, loading, page; sso has SsoTable). Backend endpoints for provider CRUD not visible.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/idp/page.tsx`, `apps/web/src/app/(app)/tenant-admin/idp/IdpTable.tsx`, `apps/web/src/app/(app)/tenant-admin/sso/page.tsx`
- **Fix steps:**
  1. Decide (product) whether provider create/edit is in scope; if not, remove the 'Add Provider' CTAs and the circular 'Configure IDP' links and state 'Providers are configured by the platform team' where applicable.
  2. If in scope: create idp/new/page.tsx and idp/[id]/page.tsx with zod-validated form posting via /api/proxy, plus actions Test connection, Disable, Delete (ConfirmDialog with reason) - each emits an audit event on the backend.
  3. Add an Actions column or rowHref in IdpTable for the detail page.
  4. Never render client secrets; use write-only fields.
- **Acceptance:**
  - Manual: no link path loops between idp and sso pages.
  - If built: create/edit/test/disable flows work and each appears in the audit log.
  - Component test: IdpTable rows navigate to detail.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Identity provider changes can lock all users out; require confirm + reason; secrets handling.

### GAP-TENANT-ADMIN-IDP-03  ·  MEDIUM  ·  partly  ·  theme I18N

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Endpoint column prints raw URLs / ldaps hosts (may embed realm or bind details) to all three roles, and Last Sync uses toLocaleString without IST label (IdpTable.tsx:25-26).
- **Verified evidence:** IdpTable.tsx:25 prints row.endpoint raw in a mono span for all users allowed by the layout (tenant_admin, platform_admin, super_admin) - it is included in the CSV export too. Whether endpoints embed realm/bind details depends on data (unverifiable; type is a plain string, loaders.ts:4697). Line 26 formats lastSync with new Date(...).toLocaleString('en-IN',{dateStyle,timeStyle}) with no timeZone option, so it renders in the browser's zone with no IST label; an empty/invalid lastSync would print 'Invalid Date'. No i18n keys are used on this page.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/idp/IdpTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatDateTimeIST(iso) in lib/formatters.ts (Intl.DateTimeFormat en-IN, timeZone 'Asia/Kolkata', append 'IST') returning '—' for null/invalid; use it at line 26 and in the mfa/domain tables.
  2. Show only scheme+host of endpoint (new URL(...).origin with try/catch) in the cell; strip userinfo/query; keep full value out of CSV or drop the endpoint column from export.
  3. Confirm with security whether endpoint should be visible to tenant_admin at all.
- **Acceptance:**
  - Unit test: formatDateTimeIST('2026-09-29T00:00:00Z') -> '29 Sept 2026, 5:30 am IST' style; invalid -> '—'.
  - Unit test: endpoint 'https://user:pw@idp.example/realms/x?a=b' displays 'https://idp.example'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; do not hide info operators need to debug without confirming with them.
- **Depends on:** GAP-TENANT-ADMIN-MFA-03

### GAP-TENANT-ADMIN-IDP-04  ·  LOW  ·  partly  ·  theme PII

- [x] **Status** (W1 follow-up: closed by #2002, verified on main d341ad6f1)
- **First-pass claim:** Duplicate Add Provider CTA (header and EmptyState) and exportable table with no audit of export (IdpTable.tsx:32-34).
- **Verified evidence:** Export: IdpTable.tsx:33-34 sets exportable + exportFilename; ds/DataTable.tsx downloadCsv (lines ~267-290) builds a client-side Blob CSV of all columns (including endpoint) with no audit call or role check - true. Duplicate CTA is weak: idp/page.tsx:23 header 'Add Provider' is always shown, and the second (line 50) appears only in the empty state, which is a normal pattern (and both go to the same place, see IDP-02).
- **Files to change:** `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/app/(app)/tenant-admin/idp/IdpTable.tsx`
- **Fix steps:**
  1. Add an optional onExport?: (rowCount:number, filename:string)=>void prop (or exportAuditKey) to DataTable, invoked from downloadCsv; wire in IdpTable/MfaTable to POST an audit event via /api/proxy (endpoint to be defined by backend).
  2. Allow columns to opt out of export via Column.exportable=false (for endpoint).
  3. Leave the empty-state CTA as is.
- **Acceptance:**
  - Component test: clicking '⬇ CSV' calls onExport once with row count.
  - Backend: an export audit event exists per download.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DataTable is shared across the app - change must be additive/optional to avoid regressions.
- **Depends on:** GAP-TENANT-ADMIN-MFA-03


---
## /tenant-admin/install  —  `tenant-admin/install.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/install.html`

### GAP-TENANT-ADMIN-INSTALL-01  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** The Setup Progress card renders even when steps=[] (0% and '0/0 steps' beside an EmptyState) — two contradictory panels (page.tsx:49-63).
- **Verified evidence:** install/page.tsx:49-58 renders the 'Setup Progress' Card (progressPct 0, '0/0 steps', ProgressBar value 0) unconditionally in the non-error branch; the steps.length === 0 EmptyState only replaces the second card (lines 60-63). With total=0 the page shows 0% progress next to 'No installation steps found'.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/install/page.tsx`
- **Fix steps:**
  1. Wrap the Setup Progress Card in `total > 0 &&`.
  2. Show '—' instead of '0%' in the Progress StatCard (line 38) when total === 0.
  3. Keep the EmptyState with 'Open Installer' action.
- **Acceptance:**
  - Test: getInstallSteps returns [] -> no progress bar and no '0/0 steps' text, EmptyState visible.
  - Test: with steps, progress card renders as before.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-INSTALL-02  ·  MEDIUM  ·  partly  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Steps are read-only: no link to the step's own installer page, so an admin must go to /install and find it; a step in progress has no owner/last-updated (page.tsx:66-84).
- **Verified evidence:** install/page.tsx:66-84: each step <li> is plain text with icon, number, title, description and a StatusPill; no anchor to a step page. A step page exists (apps/web/src/app/(app)/install/steps/page.tsx) and the header has one generic 'Open Installer' link to /install (line 30). Owner / last-updated: InstallStepSummary comes from @civitasone/types (not in the snapshot) and the page only uses id, stepNo, title, description, status, so whether such fields exist cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/install/page.tsx`
- **Fix steps:**
  1. Make the step title a link to /install/steps#<stepNo> (or the specific route the installer uses - verify against (app)/install/steps/page.tsx anchors).
  2. Only show owner/updatedAt if the InstallStepSummary type and API expose them; otherwise leave out and raise a backend request.
  3. Ensure link has 44px hit area and visible focus.
- **Acceptance:**
  - Manual: clicking a step opens the installer at that step.
  - Test: each list item contains a link to the installer with its step number.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; owner/updated fields would need backend/type check.

### GAP-TENANT-ADMIN-INSTALL-03  ·  LOW  ·  partly  ·  theme A11Y (was STATUS)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Three different status vocabularies (emoji, Done/In Progress/Pending pill, raw status) and emoji-only status glyphs marked aria-hidden; StatusPill 'in progress' string mapping (page.tsx:8-12,80).
- **Verified evidence:** True: install/page.tsx:8-12 stepIcon returns emoji (✅/🔄/⬜) rendered aria-hidden at line 69, while line 77 renders a StatusPill with explicit label Done/In Progress/Pending, so status is conveyed twice (icon + pill) - not 'three vocabularies'; raw status is never printed. Actually wrong: the emoji is redundant, not the only glyph, so screen readers still get the text pill. Real issues: STATUS_MAP in ds/StatusPill.tsx maps both 'in progress' and 'pending' to 'warn', so those two are the same colour; the stat cards count status === 'pending' (line 41) while stepIcon/pill treat any unknown status (e.g. failed) as Pending, so counts may not add up to total.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/install/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Pass step.status straight to StatusPill (normalise underscore: replace('_',' ')) and drop the nested ternaries; add 'failed' handling.
  2. Add an 'in progress' -> 'info' tone (only if it does not alter other screens; otherwise add a `tone` override prop).
  3. Drop the emoji or keep decorative; compute Pending as total - completed - inProgress (or handle 'failed').
  4. Keep aria-hidden on decorative glyph.
- **Acceptance:**
  - Test: statuses completed/in_progress/pending/failed each render a distinct label and the four stat cards sum to total.
  - Visual check: in-progress and pending pills differ in colour.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** StatusPill is shared; changing STATUS_MAP tone for 'in progress' affects other screens - prefer local override.

### GAP-TENANT-ADMIN-INSTALL-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** DataSourceBadge and RefreshErrorState render together on error, saying the same thing twice (page.tsx:35,46).
- **Verified evidence:** install/page.tsx:35 always renders <DataSourceBadge source={source}/> (which shows an amber 'unavailable' message when source==='error'; renders nothing when api - see _components/DataSourceBadge.tsx) and lines 44-47 also render RefreshErrorState for the same errored condition. Result: two messages for one failure. (idp/mfa pages do not have the duplicate; they leave the badge to the table.)
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/install/page.tsx`
- **Fix steps:**
  1. Remove line 35 DataSourceBadge (and its import), since errored path already shows RefreshErrorState and the success path needs no badge.
  2. Alternatively render the badge only when !errored, but the badge is empty in that case, so removal is simplest.
- **Acceptance:**
  - Test: with source 'error' exactly one error message (RefreshErrorState) is in the DOM.
  - Manual: success path unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /tenant-admin/mfa  —  `tenant-admin/mfa.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/mfa.html`

### GAP-TENANT-ADMIN-MFA-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle says 'user-level MFA controls' but the page is read-only: no reset/re-enrol/require-MFA action, and the row has no link to the user's security page (page.tsx:22-24, MfaTable.tsx:20-36).
- **Verified evidence:** mfa/page.tsx:23 subtitle says 'Multi-factor authentication enrollment status and user-level MFA controls'. The page (page.tsx) and MfaTable.tsx:19-35 are read-only: columns name/email/department/status/enrolledAt, no actions column, no rowHref (ds/DataTable supports rowHref at DataTable.tsx:56,210). A per-user page exists (tenant-admin/users/[id]/page.tsx:53 shows MFA enabled/disabled) but its UserSecurityActions.tsx only offers Reset password and Revoke all sessions - no MFA reset/re-enrol/require action anywhere in the snapshot. MfaUserStatus (loaders.ts:4673) has id, so linking is possible.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/mfa/MfaTable.tsx`, `apps/web/src/app/(app)/tenant-admin/mfa/page.tsx`, `apps/web/src/app/(app)/tenant-admin/users/[id]/UserSecurityActions.tsx`
- **Fix steps:**
  1. Pass rowHref={(r) => `/tenant-admin/users/${r.id}`} to DataTable in MfaTable so a row opens the user's security page.
  2. Change subtitle to 'Multi-factor authentication enrollment status' unless actions are added.
  3. If MFA controls are wanted: add 'Reset MFA' to UserSecurityActions via ConfirmDialog (reason) posting to an identity-service endpoint (must be confirmed to exist) and emitting an audit event.
  4. Backend must expose the MFA reset endpoint - do not invent it client-side.
- **Acceptance:**
  - Component test: clicking a row navigates to /tenant-admin/users/<id>.
  - Subtitle matches actual capabilities.
  - If reset added: confirm dialog requires reason, audit event recorded, list refreshes.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** MFA reset is a privileged account-takeover vector; needs reason, audit and preferably step-up. Link-only change is low risk.
- **Depends on:** ConfirmDialog

### GAP-TENANT-ADMIN-MFA-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Enrollment % counts only mfaStatus==='active'; any other value (e.g. disabled, not_enrolled) is uncounted and 'Pending' only matches 'pending', so the four KPIs need not sum to Total (page.tsx:12-15).
- **Verified evidence:** mfa/page.tsx:12-15: enrolled = count(mfaStatus==='active'), pending = count(mfaStatus==='pending'), pct = enrolled/total. mfaStatus is an open string (loaders.ts:4678), so values like 'disabled', 'not_enrolled', 'locked' fall into neither KPI; 'Pending' and 'MFA Enrolled' need not sum to Total Users, and there is no 'Not enrolled' figure. Actual API values are not visible in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/mfa/page.tsx`
- **Fix steps:**
  1. Compute notEnrolled = totalUsers - enrolled - pending and show it (or replace 'Enrollment %' with a 'Not enrolled' StatCard).
  2. Case/whitespace normalise mfaStatus before comparing (toLowerCase).
  3. Add a test fixture with 'disabled' and 'not_enrolled' users; confirm actual enum with the identity service.
  4. Optionally show an 'Other' count when statuses are unrecognised.
- **Acceptance:**
  - Unit test: 10 users (5 active, 2 pending, 3 not_enrolled) -> KPIs show 5, 2, 3 and 50%.
  - KPIs always add to Total.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; security posture reporting accuracy.

### GAP-TENANT-ADMIN-MFA-03  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-08 #2012 (export is permission-gated and fail-closed audited): closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Exportable CSV of names, emails and departments with no audit of export or masking; staff email addresses are personal data under DPDP (MfaTable.tsx:31-35).
- **Verified evidence:** MfaTable.tsx:20-34 shows name, email and department and sets exportable + exportFilename='mfa-status'; ds/DataTable.tsx downloadCsv (~lines 267-292) builds the CSV in the browser (all rows matching filter, not paged) with no audit call, no role check, no masking. Emails are shown unmasked on screen (line 22). CLAUDE.md requires audit events for mutations; export is a read but DPDP guidance expects logging of bulk personal data extraction. No <Masked> component was located in the snapshot (would need to be created).
- **Files to change:** `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/app/(app)/tenant-admin/mfa/MfaTable.tsx`, `apps/web/src/app/_components/ds/Masked.tsx`
- **Fix steps:**
  1. Add optional onExport callback prop to DataTable.downloadCsv (see IDP-04) and use it in MfaTable to POST an audit event (backend endpoint to be defined) before downloading.
  2. Create ds/Masked.tsx (mask a@b.com -> a***@b.com) with role-based reveal; use it for the email column and CSV cell values unless user role allows reveal.
  3. Alternatively remove exportable from MfaTable unless business requires it.
  4. Backend: accept export-audit events with actor, resource and row count.
- **Acceptance:**
  - Component test: email column renders masked for tenant_admin, revealed for the permitted role.
  - Component test: clicking CSV triggers the audit callback once.
  - Backend: audit event visible in tenant audit log.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Shared DataTable change; masking may hinder admins who need full emails - needs decision on who may reveal.
- **Depends on:** GAP-TENANT-ADMIN-IDP-04

### GAP-TENANT-ADMIN-MFA-04  ·  LOW  ·  partly  ·  theme COPY (was STATUS)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** 'MFA Enrolled' vs 'Enrollment %' vs 'Pending' mix spellings (enrollment/enrolled) and StatusPill renders raw status strings (MfaTable.tsx:24).
- **Verified evidence:** Overstated: MfaTable.tsx:24 uses StatusPill, which does NOT print the raw string - ds/StatusPill.tsx:61 falls back to humanizeStatus(status) (e.g. 'not_enrolled' -> 'Not Enrolled'). True parts: STATUS_MAP has 'active' and 'pending' but no 'disabled', 'not_enrolled', 'enrolled', so those render with the default 'info' tone; the row pill says 'Active' while the KPI (page.tsx:32) says 'MFA Enrolled' and page.tsx:33 'Enrollment %' - 'enrolled' vs 'enrollment' are both correct English, but 'Active' vs 'Enrolled' is inconsistent terminology.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/mfa/MfaTable.tsx`, `apps/web/src/app/(app)/tenant-admin/mfa/page.tsx`
- **Fix steps:**
  1. Pass an explicit label map to StatusPill in MfaTable: active->'Enrolled', pending->'Pending', disabled/not_enrolled->'Not enrolled'.
  2. Use the same nouns in KPIs: 'Enrolled', 'Enrolled (%)', 'Pending', 'Not enrolled'.
  3. Add tone mapping for unknown values via a local wrapper if shared STATUS_MAP shouldn't change.
- **Acceptance:**
  - Component test: each mfaStatus value shows the mapped label and tone.
  - KPI labels match row-pill wording.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-MFA-02


---
## /tenant-admin/notifications  —  `tenant-admin/notifications.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/notifications.html`

### GAP-TENANT-ADMIN-NOTIFICATIONS-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Reset to defaults' persists immediately (persist(next,'Reset')) with no confirmation and no audit reason — one mis-click rewrites every event's channels tenant-wide (NotificationPrefActions.tsx:105-110).
- **Verified evidence:** NotificationPrefActions.tsx:247-252 resetToDefaults() builds DEFAULTS (email+in-app true) for every pref, setPending, then immediately void persist(next,'Reset') (a PATCH per differing row, lines 223-233) with no dialog, reason or undo. Button at 262. ConfirmDialog (ds, supports requireReason) exists but is unused. Whether prefs are tenant-wide or per-user is not verifiable here (see -04); the PATCH body has no reason field.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/notifications/NotificationPrefActions.tsx`, `notification-service (not in snapshot): PATCH prefs route`
- **Fix steps:**
  1. Import ConfirmDialog from ds; add `confirmReset` state. Button onClick opens the dialog with description 'This resets Email and In-app for N events to defaults'.
  2. Set requireReason with reasonLabel 'Reason for reset'; on confirm call persist(next,'Reset', reason).
  3. Send reason in PATCH body only once backend accepts it; backend must write an audit event (actor, prefIds, before/after, reason).
  4. Make Reset stage changes only (setPending) and let the admin press Save, as a cheaper alternative if backend audit is not ready.
  5. maker!=checker is over-scoped for a preference toggle; treat as decision.
- **Acceptance:**
  - Click Reset: dialog appears; Cancel makes no fetch (component test asserts fetch not called).
  - Confirm without reason is disabled; with reason PATCHes only rows differing from defaults.
  - Audit log shows one entry with the reason.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Bulk tenant-wide change of who receives approval/alert emails; accidental reset can silence or flood approvers.
- **Depends on:** GAP-TENANT-ADMIN-NOTIFICATIONS-02

### GAP-TENANT-ADMIN-NOTIFICATIONS-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Save loops PATCH per row and returns on the first failure, leaving earlier rows saved and later ones not; the UI then shows an error but the dirty state no longer matches the server (NotificationPrefActions.tsx:70-92).
- **Verified evidence:** NotificationPrefActions.tsx:223-233 sequentially awaits PATCH per dirty id and `return`s at the first !res.ok (229-232) without router.refresh(); earlier rows are already saved server-side but `initial` (from server props, 183-187) is stale, so those rows still show dirty, the error text does not say how many saved, and a retry re-sends them. Reset (persist with `next`) has the same issue.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/notifications/NotificationPrefActions.tsx`
- **Fix steps:**
  1. Track results: collect saved ids and failed ids per row instead of returning early (try each, or stop but remember progress).
  2. After any success call router.refresh() even on partial failure so `initial` matches the server.
  3. Message: 'Saved X of Y; N failed: <labels>. Retry' with failed rows highlighted (aria-live already present).
  4. Better: ask backend for a bulk endpoint PATCH /notifications/prefs (atomic) and replace the loop.
  5. Add a component test with fetch mocked to fail on the 2nd of 3 calls.
- **Acceptance:**
  - Fail 2nd of 3 PATCHes: UI reports 1 saved, 2 not saved, and the saved row no longer shows dirty after refresh.
  - Retry only re-sends failed rows.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Partial notification config state; low money risk but silent misconfiguration of who is alerted.

### GAP-TENANT-ADMIN-NOTIFICATIONS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** KPIs 'SMS On' and the SMS/Webhook pills count and display channels the admin cannot change; the 'Audit changes' link goes to the unfiltered audit log (page.tsx:24,31; NotificationPrefActions.tsx:143-144).
- **Verified evidence:** notifications/page.tsx:12,31 KPI 'SMS On' counts pref.smsEnabled; NotificationPrefActions.tsx:143-144 renders static SMS/Webhook pills (no toggle); the component header comment (171-174) says backend does not store SMS/Webhook. Audit link (page.tsx:24) is plain /tenant-admin/audit; audit/page.tsx does not read searchParams, so no filtering is possible today.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/notifications/page.tsx`, `apps/web/src/app/(app)/tenant-admin/notifications/NotificationPrefActions.tsx`, `apps/web/src/app/(app)/tenant-admin/audit/page.tsx`
- **Fix steps:**
  1. Remove the 'SMS On' StatCard or replace with 'Email/In-app off' counts; label SMS/Webhook pills as 'read-only' with title text (or hide until supported).
  2. Change 'Audit changes' href to /tenant-admin/audit?entity=notification-prefs and add searchParams filtering in audit/page.tsx (client filter on event type, or backend query param).
  3. Ensure the page emits an audit event type that the filter matches (backend).
- **Acceptance:**
  - KPI row shows only counts of channels the admin can change.
  - Audit changes link opens the audit list filtered to notification-preference events.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; avoids admins thinking SMS is configured/enforced when it is not.

### GAP-TENANT-ADMIN-NOTIFICATIONS-04  ·  MEDIUM  ·  partly  ·  theme COPY (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Left card duplicates the right card's event list (same events twice on one screen); loader hits /api/notification/preferences (per-user path?) while copy says tenant 'across all modules' — scope unclear (page.tsx:37-52, loaders.ts:4334).
- **Verified evidence:** True: left 'Notification events' card (notifications/page.tsx:37-52) lists every pref label/module/event, and the right card (NotificationPrefActions) lists the same labels grouped by module, so events appear twice. Loader reads GET /api/notification/preferences (loaders.ts:4335) while writes go to /api/proxy/notification/prefs/:id (Actions:82), and subtitle says 'across all modules'; whether these are tenant defaults or the logged-in user's prefs cannot be verified because notification-service is not in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/notifications/page.tsx`, `apps/web/src/app/(app)/tenant-admin/notifications/NotificationPrefActions.tsx`
- **Fix steps:**
  1. Remove the left card (or turn it into a one-line summary) and let the grid be single column with NotificationPrefActions.
  2. Confirm with notification-service owners whether /preferences is tenant-level; align the subtitle ('Default channels for every user' vs 'Your channels').
  3. If per-user, move page out of tenant-admin or add tenant-default endpoint.
- **Acceptance:**
  - Each event label appears once on the page.
  - Subtitle matches API scope, documented in the loader comment.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Editing wrong scope (own prefs vs tenant defaults) changes who is notified for everyone.

### GAP-TENANT-ADMIN-NOTIFICATIONS-05  ·  LOW  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed load shows 0s and empty states, no RefreshErrorState; ch=pending[pref.id] would throw if props refresh adds a new pref id (page.tsx:34, NotificationPrefActions.tsx:136).
- **Verified evidence:** notifications/page.tsx:5-9 KPIs are computed from prefs=[] on failure; only DataSourceBadge is shown (34) and the empty branch shows 'No notifications configured' (47-50), so a failed load reads as zero settings; no RefreshErrorState (unlike operations/org-hierarchy). Separately NotificationPrefActions.tsx: `pending` is useState(initial) (189) and never resynced; if router.refresh()/revalidate (120s) returns a new pref id, `pending[pref.id]` is undefined at 136 and isDirty(p.id,pending) at 254 dereferences undefined, throwing during render.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/notifications/page.tsx`, `apps/web/src/app/(app)/tenant-admin/notifications/NotificationPrefActions.tsx`
- **Fix steps:**
  1. In page.tsx gate on source==='error': render RefreshErrorState (toHumanError('load',{area:'notification preferences'})) and show '—' in StatCards, skip NotificationPrefActions.
  2. In NotificationPrefActions read `pending[id] ?? initial[id]` in isDirty and render; or key the component on a hash of prefs ids so state resets when the list changes.
  3. Add a test rendering with prefs then rerender with an extra pref; must not throw.
- **Acceptance:**
  - Force API error: page shows error state with retry, not zeros.
  - Rerender with a new pref id: no exception, new row shows server values.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Render crash on the admin page after data refresh.


---
## /tenant-admin/notifications/channels  —  `tenant-admin/notifications-channels.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/notifications-channels.html`

### GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — ChannelForm Add form exists; edit, test-send and disable intentionally not built (backend has create+list only)
- **First-pass claim:** Subtitle says 'Configure … providers' but the only way to add a channel is to hand-craft a POST body shown in a <pre>; no Add channel form, edit, test-send or disable (page.tsx:37-42,67-87).
- **Verified evidence:** notifications/channels/page.tsx:39 subtitle promises 'Configure email, SMS, and push providers'; the page is a read-only DataTable (54-63) plus a 'How to configure' card (67-84) showing a raw `POST /api/notification/channels` body in a <pre> (70-81). No form, edit, test-send or disable control exists; the file has no client component.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/notifications/channels/page.tsx`, `apps/web/src/app/(app)/tenant-admin/notifications/channels/ChannelForm.tsx (new)`, `apps/web/src/app/(app)/tenant-admin/notifications/channels/ChannelRowActions.tsx (new)`
- **Fix steps:**
  1. Create client component ChannelForm (ds Button/Card, useFormError('channel')) with fields name, type (select email/sms/push), provider (select filtered by type: ses/smtp -> email, sns -> sms, fcm -> push), and config fields per provider (region, fromAddress...); validate with a zod schema before POST.
  2. POST to the proxy route (/api/proxy/notification/channels) and router.refresh() on success; surface failures via useFormError.fromResponse.
  3. Add ChannelRowActions column to the DataTable: Test send, Enable/Disable, Edit. Wrap disable in ds ConfirmDialog.
  4. Remove the 'How to configure' developer card from page.tsx once the form exists; keep a short admin-language help line.
  5. If the notification-service has no PATCH/test-send endpoint, ship Add + list first and hide the unsupported actions rather than showing dead buttons.
- **Acceptance:**
  - Component test: submitting an empty ChannelForm shows field errors and sends no request.
  - Manual: add an SES channel, list refreshes with new row status; Test send returns success/failure toast.
  - Manual: Disable asks for confirmation and row status flips.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Channel config holds provider settings; never render secrets (accessKey/password) back in the table or echo config in responses. Wrong provider config silently drops approval reminders.

### GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Column header literally reads 'Type (email/sms/push)' — developer hint leaking into the UI; provider config (region, fromAddress) is fetched but never displayed (page.tsx:57).
- **Verified evidence:** channels/page.tsx:57 column label is literally 'Type (email/sms/push)'. The Channel type declares `config?` (11) and the loader fetches it but the columns (55-60) show only name/type/provider/status, so region/fromAddress are never shown. Not a PII issue (in fact not rendering config avoids leaking secrets).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/notifications/channels/page.tsx`
- **Fix steps:**
  1. Rename the column label to 'Channel type' and render values via a label map (email -> Email, sms -> SMS, push -> Push notification).
  2. Add a non-secret 'Sender / region' column derived from a whitelist of config keys (fromAddress, region, senderId); never render unknown config keys.
  3. Drop the PII framing: no <Masked> needed unless a secret key is ever returned by the API.
- **Acceptance:**
  - Header reads 'Channel type' with no parenthetical.
  - A channel with config.fromAddress shows it in the Sender column; a config key such as password never appears in the DOM.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; only ensure whitelist so secrets are not exposed if the API returns them.
- **Depends on:** GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-01

### GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-03  ·  MEDIUM  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Documentation snippet embeds a sample API path and 'noreply@yourdomain.gov.in' for clerks; tone is developer, not admin (page.tsx:70-84).
- **Verified evidence:** channels/page.tsx:67-84: card titled 'How to configure' shows `POST /api/notification/channels` JSON with placeholder "noreply@yourdomain.gov.in" (78) and provider list (82). Developer-oriented text on an admin screen.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/notifications/channels/page.tsx`
- **Fix steps:**
  1. Delete the API snippet card (or, until the form ships, replace with plain-language steps and a link to admin help).
  2. Keep the supported-provider explanation but as friendly labels (AWS SES email, SMTP email, AWS SNS SMS, Firebase push) in a HelpTip or form helper text.
  3. Move any remaining strings to next-intl keys.
- **Acceptance:**
  - No occurrence of 'POST /api' or 'yourdomain' in the rendered page.
  - Provider names are shown in plain words.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-01

### GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-04  ·  LOW  ·  confirmed  ·  theme DARKMODE (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Sample JSON block uses hex background and inline styles; no copy button (page.tsx:72).
- **Verified evidence:** channels/page.tsx:70 <pre> uses hard-coded background #f8fafc and inline style; there is no copy button. Hex background will not follow dark mode. No i18n keys used on the page (all literals).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/notifications/channels/page.tsx`
- **Fix steps:**
  1. If the snippet is retained, use a token class (e.g. var(--surface2)) instead of #f8fafc and add a small ds Button 'Copy' with aria-label using navigator.clipboard.
  2. Preferably resolved by removing the snippet (see -01/-03).
  3. Move page strings to next-intl.
- **Acceptance:**
  - Dark mode: code block background follows theme.
  - Copy button copies the JSON and announces 'Copied' via aria-live.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-01, GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-03


---
## /tenant-admin/operations  —  `tenant-admin/operations.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/operations.html`

### GAP-TENANT-ADMIN-OPERATIONS-01  ·  HIGH  ·  partly  ·  theme ROLEGATE (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Home hides the Operations tile from tenant_admin but the layout allows them in; a direct visit is silently redirected to /tenant-admin with no message, and 'Export report'/'Operations' affordances differ per role (page.tsx:47, home page.tsx:13,31).
- **Verified evidence:** Route is intentional: operations/page.tsx:47 requireAnyRole(['platform_admin','super_admin'],'/tenant-admin') while layout.tsx ALLOWED includes tenant_admin, and tenant-admin/page.tsx:13,31 hides the Operations button for tenant_admin. So tenant_admin never sees the tile and a direct visit redirects silently with no message (roleGuard.ts:49-53 just redirect()). 'Export report' (page.tsx:30) is shown to all roles, so only the Operations affordance differs. Not a PII issue.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/operations/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`, `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Fix steps:**
  1. Redirect with a reason: requireAnyRole(..., '/tenant-admin?denied=operations') and show a dismissible ds notice/Toast on TenantAdminPage reading searchParams.
  2. Or render an in-place 'Restricted to platform administrators' EmptyState instead of redirecting.
  3. Note in page.tsx that Export report links to /tenant-admin/audit?export=true, which audit/page.tsx ignores (no searchParams handling) - track separately.
- **Acceptance:**
  - tenant_admin visiting /tenant-admin/operations lands with a visible 'You do not have access' message.
  - platform_admin still sees the dashboard.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; do not weaken the role gate.

### GAP-TENANT-ADMIN-OPERATIONS-02  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Ops Score' /10 is a client-side heuristic (8 equally weighted booleans, rounded) with no explanation; an empty schedulers list or absent PM2 silently lowers it (page.tsx:15-27).
- **Verified evidence:** operations/page.tsx:15-27 operationsScore = round(passing/8*10) over 8 equal boolean checks; displayed as 'Ops Score n/10' (85) with no tooltip or breakdown. pm2Available=false, no processes, or schedulers.length===0 each fail a check, so absent PM2 silently lowers the score. Granularity is 8 checks mapped to /10 so values 1,3,4,6,8 are skipped.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/operations/page.tsx`
- **Fix steps:**
  1. Return the list of failed check labels from operationsScore and render them (ds HelpTip or a small list) under the card.
  2. Show 'n of 8 checks passing' instead of x/10, or document weights.
  3. Treat 'not reported' (PM2 unavailable) as 'Unknown' rather than failing every dependent check.
- **Acceptance:**
  - Ops Score card explains which checks failed.
  - With PM2 unavailable the card shows Unknown/partial, not a low health score.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Misleading health indicator for operators; no money/PII risk.

### GAP-TENANT-ADMIN-OPERATIONS-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Processes Not Online' is fed by summary.failedJobs and the incident text calls it '{n} PM2 process(es) are not online' — the field name suggests failed jobs, not processes (page.tsx:34,88).
- **Verified evidence:** operations/page.tsx:88 StatCard 'Processes Not Online' shows ops.summary.failedJobs and :34 incident text says '{n} PM2 process(es) are not online' from the same field. loaders.ts:989 names it failedJobs and no code derives it from processes. Whether admin-service defines failedJobs as non-online processes cannot be verified (service not in snapshot); the web can compute total-online itself.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/operations/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Compute notOnline = summary.totalProcesses - summary.onlineProcesses in page.tsx and use it for the card, incident text and score check.
  2. If backend truly means failed jobs, rename the card 'Failed jobs' and add a separate not-online count.
  3. Add a unit test for incidentSummary with failedJobs>0 and all processes online.
- **Acceptance:**
  - Card value equals totalProcesses-onlineProcesses.
  - Incident text wording matches the field shown.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Operators could chase the wrong incident type.

### GAP-TENANT-ADMIN-OPERATIONS-05  ·  LOW  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** External alerting card is static recommendation text, not live status; scheduler table lacks IST timezone label; two identical 'No PM2 data' empty states can appear together (page.tsx:103-120,124-136).
- **Verified evidence:** operations/page.tsx:102-119 External alerting card is a list of ops.externalMonitorRecommendation plus a hard-coded 'Required alerts' row (116) with a 'recommended' pill; it is not live status. OperationsTables.tsx:183-187 formatDate uses toLocaleString('en-IN') with no timeZone option and the column 'Last cron run' (226) has no zone label. ProcessesTable is used for both services (127) and workers (135), so with no PM2 data both cards show the identical 'No PM2 data' EmptyState (195).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/operations/page.tsx`, `apps/web/src/app/(app)/tenant-admin/operations/OperationsTables.tsx`
- **Fix steps:**
  1. Set timeZone: 'Asia/Kolkata' in both formatDate helpers (also fixes SSR/client mismatch) and append 'IST' to header or values.
  2. Pass an emptyTitle/emptyMessage prop to ProcessesTable ('No worker processes reported' vs 'No service processes reported'), or show one empty state when pm2Available is false.
  3. Rename the alerting card 'Recommended external monitoring' and show real alert wiring status only if the backend exposes it.
- **Acceptance:**
  - Cron time renders with IST label regardless of browser tz.
  - With no PM2, only one explanatory empty state or two distinct ones.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /tenant-admin/org-hierarchy  —  `tenant-admin/org-hierarchy.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/org-hierarchy.html`

### GAP-TENANT-ADMIN-ORG-HIERARCHY-01  ·  HIGH  ·  confirmed  ·  theme A11Y (was ROLEGATE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Tree has role=tree/treeitem and aria-expanded=true but nodes cannot be collapsed or focused/arrow-navigated; ARIA tree semantics without the keyboard contract mislead screen-reader users (page.tsx:39-48,92).
- **Verified evidence:** org-hierarchy/page.tsx:39-48 each <li role='treeitem'> has aria-expanded={true} for parents, aria-selected={false}, but no tabIndex, key handler, aria-level/posinset, and children are rendered as sibling <li> in a fragment (49-51), not inside role='group'. Nothing can collapse. The ul role='tree' (92) therefore advertises a keyboard contract that does not exist.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/org-hierarchy/page.tsx`, `apps/web/src/app/(app)/tenant-admin/org-hierarchy/OrgTree.tsx (new, optional)`
- **Fix steps:**
  1. Simplest: drop role tree/treeitem/aria-expanded/aria-selected and render nested <ul><li> so screen readers get list semantics with depth.
  2. If collapse is wanted: make OrgTree a client component using <details>/<summary> or buttons with aria-expanded controlling nested role='group'; implement roving tabindex, Arrow/Home/End keys and aria-level.
  3. Keep TreeNode purely presentational for the server page.
- **Acceptance:**
  - Screen reader announces nested list levels, no 'expanded' state on non-interactive nodes.
  - If tree kept: Tab enters once, Arrow keys move, Left/Right collapse/expand (component test).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** None.

### GAP-TENANT-ADMIN-ORG-HIERARCHY-03  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Read-only page titled as admin config: no add/edit/move of units and no link to org-type or the separate org-hierarchy-levels taxonomy (getOrgHierarchyLevels), so admins cannot act on what they see.
- **Verified evidence:** org-hierarchy/page.tsx is read-only: PageHeader has no actions and no links (68-72). Editing exists elsewhere: app/(app)/admin/org/OrgHierarchyManager.tsx and the level taxonomy via getOrgHierarchyLevels (loaders.ts:5060) on platform-admin/org-config/page.tsx, but neither is linked from here, and org-type page is separate.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/org-hierarchy/page.tsx`
- **Fix steps:**
  1. Add PageHeader actions: 'Manage units' -> /admin/org (verify role access), and 'Organisation type' -> /tenant-admin/org-type; show 'Hierarchy levels' link to platform-admin/org-config only for platform_admin/super_admin (getSessionRoles).
  2. Adjust the page title/subtitle to 'view' wording if editing stays elsewhere.
  3. Decide whether add/edit/move belongs on this page or /admin/org and remove duplication.
- **Acceptance:**
  - tenant_admin sees a working link to the edit screen; role-limited links absent for others.
  - No link leads to a redirect.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Verify /admin/org role gate to avoid linking to a page that redirects.

### GAP-TENANT-ADMIN-ORG-HIERARCHY-04  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Indent is set via paddingLeft then overridden by the padding shorthand in the same style object; 'Departments' counts every node including the root (page.tsx:16-22,43).
- **Verified evidence:** org-hierarchy/page.tsx:43 style has paddingLeft then padding shorthand; the shorthand comes later and already includes depth*24+12 left, so indent renders correctly and paddingLeft is merely redundant (React dev may warn about mixing on updates). True that countDepts (17-23) includes root nodes so 'Departments' counts the root org, which is also shown as 'Root Org'.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/org-hierarchy/page.tsx`
- **Fix steps:**
  1. Remove the redundant paddingLeft key.
  2. Rename card to 'Units' or subtract root count (countDepts(orgTree) - orgTree.length) if 'Departments' should exclude the root.
- **Acceptance:**
  - No style-mixing warning in dev console.
  - Departments count matches product definition.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /tenant-admin/org-type  —  `tenant-admin/org-type.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/org-type.html`

### GAP-TENANT-ADMIN-ORG-TYPE-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** The page invites 'Pick the one that best describes you' but cards are not interactive and none indicates the current org type; the only route is a raw PATCH shown as text (page.tsx:14-20,54-57).
- **Verified evidence:** org-type/page.tsx: cards (128-151) are plain <div>s with no handler; the page never loads the tenant's current orgType (no loader call; grep finds no orgType consumer in loaders), so nothing marks the active one; change instructions are text (155-157) 'PATCH /v1/tenants/:id ... coming soon'. Whether that PATCH endpoint exists cannot be verified (tenant/admin service absent).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/org-type/page.tsx`, `apps/web/src/app/(app)/tenant-admin/org-type/OrgTypeSelector.tsx (new)`, `apps/web/src/app/_data/loaders.ts (getTenantSettings if missing)`
- **Fix steps:**
  1. Add a loader for current tenant orgType (existing tenant/admin endpoint) and pass currentType to a client OrgTypeSelector.
  2. Render cards as radio group (role=radiogroup, buttons with aria-checked), mark current with a 'Current' pill.
  3. On selecting a different type, open ConfirmDialog (requireReason) explaining terminology/policy/feature changes; PATCH via proxy and router.refresh().
  4. Gate with existing requireAnyRole; audit event on backend.
- **Acceptance:**
  - Current type is visibly marked on load.
  - Selecting another and confirming persists; reload shows new current.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Changing org type alters terminology, CPC/CCS pay and leave rules for the entire tenant; needs confirmation and audit.

### GAP-TENANT-ADMIN-ORG-TYPE-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Developer instructions (endpoint and JSON body, 'coming soon') are exposed to office administrators (page.tsx:54-57).
- **Verified evidence:** org-type/page.tsx:155-158 paragraph exposes 'PATCH /v1/tenants/:id' with a JSON body and 'A full selector form is coming soon.' to office admins.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/org-type/page.tsx`
- **Fix steps:**
  1. Remove the paragraph; replace with 'Contact your platform administrator to change organisation type' until -01 lands (or remove when selector ships).
  2. Keep endpoint details in docs only.
- **Acceptance:**
  - No API path or JSON in the rendered page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-TENANT-ADMIN-ORG-TYPE-01

### GAP-TENANT-ADMIN-ORG-TYPE-03  ·  MEDIUM  ·  confirmed  ·  theme DARKMODE (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Cards use hard-coded white backgrounds and slate hex colours (#fff, #64748b, tag colours), which will not follow dark mode (page.tsx:26-32).
- **Verified evidence:** org-type/page.tsx:131-133 card border #e2e8f0, background #fff; 135 color #0f172a; 138 color #64748b; tags 145-147 use fixed light hex backgrounds/colours. All bypass theme tokens so dark mode shows white cards with dark text.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/org-type/page.tsx`
- **Fix steps:**
  1. Replace with tokens/classes (var(--surface), var(--line), var(--ink), var(--mut)) or the ds Card.
  2. Use the StatusPill/`pill info|good|warn` classes for the three tags.
  3. Remove unused StatGrid/StatCard imports (line 1).
- **Acceptance:**
  - Dark theme: cards and tags legible, no white blocks.
  - Light theme visually unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-TENANT-ADMIN-ORG-TYPE-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Terminology flags govtTerms/cpcPayMatrix/ccsLeaveRules are shown as tags without explanation of what each switches on; educational shows 'CPC Pay' but not 'Govt terms' (orgConfig.ts:85-89).
- **Verified evidence:** org-type/page.tsx:145-147 render tags Govt terms / CPC Pay / CCS Leave from t.govtTerms/cpcPayMatrix/ccsLeaveRules with no explanation. orgConfig.ts:84-88 educational has govtTerms false, cpcPayMatrix true, so it shows only 'CPC Pay'.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/org-type/page.tsx`, `apps/web/src/lib/orgConfig.ts`
- **Fix steps:**
  1. Add a FLAG_HELP map (in orgConfig.ts) with a one-line description per flag and render via ds HelpTip/title on each tag.
  2. Show an explicit muted 'No govt terms' when false, or list all three flags with on/off.
  3. Confirm with product that educational should use CPC pay matrix without govt terms.
- **Acceptance:**
  - Hovering/focusing a tag shows what it switches on.
  - Educational card shows a clear on/off for all three flags.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /tenant-admin/plans  —  `tenant-admin/plans.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Design reference:** `redesign/tenant-admin/plans.html`

### GAP-TENANT-ADMIN-PLANS-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Upgrade is simulated: confirmUpgrade() does setUpgradeStep(2) then setTimeout 2000 ms → step 3 'Upgrade Successful!' and mutates local currentPlanId; no payment or billing request is made (PlansClient.tsx:55-61).
- **Verified evidence:** PlansClient.tsx:55-61 confirmUpgrade(): setUpgradeStep(2); setTimeout(2000) -> setUpgradeStep(3) and setCurrentPlanId(targetPlanId). No fetch. UI shows 'Processing payment...' (178) and 'Upgrade Successful! Changes take effect immediately.' (184-185) although nothing is charged or changed server side. The only billing call in the app is the read GET /api/v1/billing/plans (loaders.ts:4598); write endpoints unverified.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/plans/PlansClient.tsx`, `apps/web/src/app/(app)/tenant-admin/plans/page.tsx`, `billing service (not in snapshot)`
- **Fix steps:**
  1. Remove the fake success path: replace confirmUpgrade with a POST via proxy to the billing/upgrade endpoint (or a 'Request upgrade' ticket if no self-serve billing), await the result and only then show success.
  2. Show real states: pending approval / failed with useFormError; use ds ConfirmDialog for step 1.
  3. After success call router.refresh() and drop local currentPlanId state (derive from data).
  4. Until the backend exists, disable the Upgrade buttons with a truthful 'Contact your administrator' message.
- **Acceptance:**
  - Component test: clicking confirm issues a request; no 'Upgrade Successful' text without 2xx.
  - Failed response shows error and plan unchanged.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Business/money: users are told they upgraded and paid when nothing happened; entitlement and invoice mismatch.

### GAP-TENANT-ADMIN-PLANS-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Downgrade 'Confirm Downgrade' only sets local state and closes — no API call, no audit reason, no check that current users/data exceed the target plan's limits beyond a warning line (PlansClient.tsx:212).
- **Verified evidence:** PlansClient.tsx:212 (line 243 by file) 'Confirm Downgrade' runs setCurrentPlanId(targetPlanId!) and closes the modal; no request, no reason, no audit. The only guard is a static warning comparing plan maxUsers (197-201), not actual active users/storage, which the page does not load.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/plans/PlansClient.tsx`, `billing service (not in snapshot)`
- **Fix steps:**
  1. Replace the modal with ds ConfirmDialog (danger, requireReason); on confirm POST downgrade request to billing API.
  2. Load current usage (users, storage, modules in use) and block/warn when usage exceeds the target plan limits; list modules that will be disabled (already computed).
  3. Backend must validate limits, apply at period end, and write an audit event.
  4. Drop local state mutation; refresh from server.
- **Acceptance:**
  - Downgrade with usage above target limits shows blocking message.
  - Confirm without reason disabled; successful request shows pending state and audit row.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Downgrade disables modules and may lock out users; must be validated and audited server-side.
- **Depends on:** GAP-TENANT-ADMIN-PLANS-01

### GAP-TENANT-ADMIN-PLANS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Header StatCards are rendered by the server page from the original currentPlanId; after a (simulated) plan change they stay stale while cards below show the new plan (page.tsx:26-31 vs PlansClient.tsx:20,94).
- **Verified evidence:** plans/page.tsx:11,21-26 StatCards derive currentPlan from server plansData.currentPlanId; PlansClient.tsx:17 holds its own currentPlanId state initialised from data (also not resynced on refresh), so after a plan change the cards below show the new plan while the header keeps the old one.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/plans/page.tsx`, `apps/web/src/app/(app)/tenant-admin/plans/PlansClient.tsx`
- **Fix steps:**
  1. Move header StatGrid into PlansClient (or lift currentPlanId to a small client wrapper) so both use one source.
  2. When real API is wired, remove local currentPlanId and rely on router.refresh() plus data.currentPlanId.
  3. Add a test switching plan and asserting both places update.
- **Acceptance:**
  - After a plan change both the header 'Current Plan' and the highlighted card show the same plan.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-PLANS-01

### GAP-TENANT-ADMIN-PLANS-04  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — Razorpay checkout and dead PDF button removed; GST invoice columns still absent (awaiting billing API)
- **First-pass claim:** 'Pay via Razorpay' presents a card-gateway checkout to a Government department whose payments run through PO/GeM/treasury; GST invoice details are absent from the invoice table and the 📥 PDF button has no handler (PlansClient.tsx:171,145).
- **Verified evidence:** PlansClient.tsx:171 (line 202 by file) primary button reads 'Pay via Razorpay'. Invoice table (166-169 in original numbering; columns Date/Amount/Status/Action) has no invoice number, GSTIN, tax split or SAC, and the '📥 PDF' Button (176) has no onClick. Whether Razorpay is the intended gateway for Govt customers is a product decision.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/plans/PlansClient.tsx`
- **Fix steps:**
  1. Decision: choose payment modes per edition (PO / GeM / treasury challan / online) and drive the button label from tenant edition/entitlement config.
  2. Add invoice number, GSTIN, taxable value, GST and total columns (amounts in paise via formatINR helper) when the API provides them.
  3. Wire the PDF button to the invoice download endpoint or remove it until available; give it aria-label 'Download invoice PDF for <date>'.
- **Acceptance:**
  - No 'Razorpay' text for Govt edition tenants.
  - PDF button downloads a file or is absent.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Billing/tax compliance; wrong payment channel shown to Government buyers.
- **Depends on:** GAP-TENANT-ADMIN-PLANS-01

### GAP-TENANT-ADMIN-PLANS-05  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Modals use hard-coded #fff and hex borders (no dark mode), lack focus trap/escape handling; isUpgrade is inferred from array order so an unsorted API response mislabels Upgrade/Downgrade (PlansClient.tsx:90,156,195).
- **Verified evidence:** PlansClient.tsx modals (line 156/195 in the finding's numbering): both dialogs use role=dialog aria-modal with inline background #fff and hex borders, no Escape handler, no focus move/trap, no overlay-click handling (no keydown or ref code in file). isUpgrade at line 121 is `plans.indexOf(plan) > plans.findIndex(current)`, order-dependent, so an unsorted API response mislabels Upgrade/Downgrade. Trial banner (112) and card borders also hard-code hex.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/plans/PlansClient.tsx`
- **Fix steps:**
  1. Use ds ConfirmDialog (focus trap, Esc, focus return already implemented) for both flows, or extract a shared Modal.
  2. Replace #fff/hex with theme tokens.
  3. Sort plans by pricePerMonth (or a backend `rank`) before rendering and compute isUpgrade from price/rank, not index.
  4. Add tests: Esc closes, focus returns to trigger, unsorted plans still label correctly.
- **Acceptance:**
  - Esc closes and focus returns; Tab stays inside dialog.
  - Given plans [Enterprise, Basic] with current Basic, Enterprise is labelled Upgrade.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Wrong Upgrade/Downgrade label on a billing action.
- **Depends on:** GAP-TENANT-ADMIN-PLANS-01


---
## /tenant-admin/platform-config  —  `tenant-admin/platform-config.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/platform-config/page.tsx`
- **Design reference:** `redesign/tenant-admin/platform-config.html`

### GAP-TENANT-ADMIN-PLATFORM-CONFIG-01  ·  HIGH  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** "Tunable Settings" has no controls: editing is described as "PATCH /v1/admin/platform-config" and "POST …/debug-mode" in helper text only, so operators cannot tune anything from the page (page.tsx:70-72, 95-97).
- **Verified evidence:** platform-config/page.tsx:65-72,95-97 render cacheTtl, rateLimits, logLevel, debugModeUntil, notifications as read-only tables/text; edit instructions are helper text ('Edit via PATCH /v1/admin/platform-config', 'POST .../debug-mode'). No input/button on the page. Overstated: /admin/config/page.tsx:34 already PATCHes /api/v1/admin/platform-config, but with a different payload (platformName, supportEmail, locale, password policy), so the controllable{} shape here is not the edit shape. No platform-config or debug-mode handler exists in this snapshot (only hrms-service present), so backend contract is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/platform-config/page.tsx`, `apps/web/src/app/(app)/tenant-admin/platform-config/CacheTtlEditor.tsx`, `apps/web/src/app/(app)/tenant-admin/platform-config/DebugModeButton.tsx`
- **Fix steps:**
  1. Confirm PATCH body schema (cacheTtl/rateLimits/logLevel) and POST debug-mode body (duration) with the admin-config owner; do not invent fields.
  2. Create client component CacheTtlEditor (numeric inputs per module, zod-validated min/max) that PATCHes /api/proxy/v1/admin/platform-config and calls router.refresh().
  3. Create DebugModeButton using ConfirmDialog requireReason, POST debug-mode with duration options (15/30/60 min), show the auto-revert time.
  4. Reuse useFormError for errors; mount editors inside the existing Cards and remove the raw-endpoint helper text.
  5. Render editors only for platform_admin/super_admin (page already guarded).
- **Acceptance:**
  - Change a module TTL, save, reload: new value shown and an audit event exists.
  - Enable debug mode with reason: 'Debug until HH:MM' pill appears; non-numeric or negative TTL is rejected inline.
  - Backend 403/422 shows a role=alert message, values not lost.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Changes live cache/rate-limit/log level for all tenants; needs reason, audit and server-side bounds.
- **Depends on:** GAP-TENANT-ADMIN-PLATFORM-CONFIG-02

### GAP-TENANT-ADMIN-PLATFORM-CONFIG-02  ·  HIGH  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Fetch failure shows only a header with "Could not load configuration. Try refreshing." — no alert role, retry, back link or reason; the page also has no error.tsx or loading.tsx so an exception uses a parent boundary (page.tsx:36-42).
- **Verified evidence:** page.tsx:36-42 on null config renders only PageHeader with subtitle text: no role=alert, no retry, no back link. Correction: tenant-admin/error.tsx and tenant-admin/loading.tsx exist at the parent level (RouteError with back link), so thrown exceptions are covered by the parent boundary; the folder simply lacks its own. Also getConfig (l.24-30) maps a non-error empty result to null, and mapResponse casts without validation so a payload missing controllable/infrastructure would throw at l.44-65 into the parent error.tsx.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/platform-config/page.tsx`, `apps/web/src/app/(app)/tenant-admin/platform-config/loading.tsx`
- **Fix steps:**
  1. In the !config branch render Card + <RefreshErrorState error={toHumanError('load',{area:'platform configuration'})} backHref='/tenant-admin'/> (same pattern as readiness/page.tsx:60-63).
  2. Add zod/isRecord guard in mapResponse so a malformed payload yields the error state, not a throw.
  3. Add platform-config/loading.tsx with skeleton matching the two grids.
  4. Fix backLabel (see -06).
- **Acceptance:**
  - Force fetch failure: role=alert error with Retry (router.refresh) and Back link appears.
  - Return {} payload: error state shown, no 500 page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-PLATFORM-CONFIG-04  ·  MEDIUM  ·  partly  ·  theme AUTHZ (was WIRING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Gate mismatch: layout admits tenant_admin but this page requires platform_admin/super_admin, so a tenant_admin who follows a link from the hub hits the guard (page.tsx:33, layout.tsx:4).
- **Verified evidence:** layout.tsx:4 ALLOWED includes tenant_admin; page.tsx:33 requireAnyRole(['platform_admin','super_admin']) redirects to /dashboard on mismatch (roleGuard.ts requireAnyRole default redirectTo). tenant-admin/page.tsx:93 shows the 'Platform Config' tile to everyone reaching the hub, so a tenant_admin clicks and is silently bounced to /dashboard. Guard itself is correct (platform-level config); the defect is the visible link and silent redirect.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/page.tsx`, `apps/web/src/app/(app)/tenant-admin/platform-config/page.tsx`
- **Fix steps:**
  1. In tenant-admin/page.tsx filter the Quick Navigation array: show /tenant-admin/platform-config only if getSessionRoles() includes platform_admin or super_admin.
  2. Optionally pass a redirectTo with a notice route instead of /dashboard.
  3. Keep the server guard unchanged.
- **Acceptance:**
  - Sign in as tenant_admin: hub has no Platform Config tile.
  - Sign in as platform_admin: tile visible and page loads.
  - Direct URL as tenant_admin still redirects.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; do not weaken the guard.

### GAP-TENANT-ADMIN-PLATFORM-CONFIG-05  ·  LOW  ·  partly  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Status conveyed by emoji (✅ ❌ ⚠️) without text-only alternative and section headings prefixed by emoji; inline styles bypass the DS (page.tsx:57,114,128,174).
- **Verified evidence:** Emoji in h2 (l.57 gear, l.114 lock) and Yes/No cells (l.128,137,174,184,185) all carry text 'Yes'/'No', so status is not emoji-only; screen readers will read emoji names though (not aria-hidden). Inline styles (l.57,62,86-90,114) and hard-coded colours (#7c2d12,#fef3c7) bypass DS tokens. No next-intl usage on page. Severity overstated.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/platform-config/page.tsx`
- **Fix steps:**
  1. Add aria-hidden to decorative emoji spans or drop them from headings.
  2. Replace inline styles with DS classes/tokens (StatCard for rate limits; StatusPill for Yes/No).
  3. Move strings to next-intl keys if the module adopts i18n (check other tenant-admin pages first).
- **Acceptance:**
  - Axe scan shows no emoji in heading accessible names.
  - Yes/No cells use StatusPill with text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic.

### GAP-TENANT-ADMIN-PLATFORM-CONFIG-06  ·  LOW  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Back label reads "Office Admin" while the breadcrumb and nav say "Tenant Admin"; TTL module names are raw object keys capitalised by CSS (page.tsx:52,66).
- **Verified evidence:** page.tsx:53 backLabel='Office Admin' while the hub Breadcrumb (tenant-admin/page.tsx:23) and sibling pages use 'Tenant Admin' (tenant-admin/error.tsx also says 'Office Admin', so naming is inconsistent app-wide). l.66 prints raw object key with CSS capitalize (e.g. 'hrms' -> 'Hrms').
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/platform-config/page.tsx`
- **Fix steps:**
  1. Set backLabel to 'Tenant Admin' (or LABELS-driven constant shared with Breadcrumb).
  2. Add a MODULE_LABELS map (or shared module-label helper) for cacheTtl keys with fallback to raw key.
  3. Decide one product term (Office vs Tenant Admin) and apply in error.tsx too.
- **Acceptance:**
  - Back link text equals breadcrumb text.
  - Key 'hrms' renders as its display name.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /tenant-admin/readiness  —  `tenant-admin/readiness.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/readiness/page.tsx`
- **Design reference:** `redesign/tenant-admin/readiness.html`

### GAP-TENANT-ADMIN-READINESS-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Checklist is a hard-coded constant (r-001…r-008) so every tenant sees the same Pass/Fail/In Progress rows regardless of its real state; only the overall % is live (page.tsx:15-24).
- **Verified evidence:** readiness/page.tsx:15-24 readinessChecklist is a constant of 8 items with fixed statuses; rendered at l.80-89 for every tenant. Only overall% comes from getTenantAdminDashboard (loaders.ts ~l.914, endpoint /api/v1/admin/health/readiness, which maps only overall/productionReady/allGreen). Per-check data is not exposed by any loader; whether backend can return per-gate results is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/readiness/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm with backend whether /api/v1/admin/health/readiness (or another endpoint) returns per-gate results; if so extend TenantAdminReadiness with gates[] and map with isRecord guards.
  2. Replace readinessChecklist const with data from the loader; render each row from it.
  3. Until available, remove the checklist card and show 'Detailed checks not available' EmptyState, or label rows 'Sample'.
  4. Derive Passed/In Progress/Failed from the same array (see -02).
- **Acceptance:**
  - Two tenants with different gate results show different rows.
  - With no per-gate data the page shows the not-available state, never fixed Pass/Fail rows.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Fake pass status on go-live readiness can mislead compliance sign-off.
- **Depends on:** GAP-TENANT-ADMIN-READINESS-02

### GAP-TENANT-ADMIN-READINESS-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** KPI counts disagree with the list: Passed is derived from overall% (round(overall/100*8)) while In Progress and Failed count the constant, so with overall 75 the tiles show 6+2+1=9 of 8 checks (page.tsx:38-41,55-58).
- **Verified evidence:** readiness/page.tsx:38-40 passed = round(overall/100*8) when readiness exists; l.57-58 count in-progress (2) and fail (1) from the constant. overall=75 -> 6+2+1 = 9 vs total 8. Also passed is not the count of pass rows (constant has 5).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/readiness/page.tsx`
- **Fix steps:**
  1. Compute all three counts from one array (post -01) with a single reduce.
  2. Derive overall% from the API value only for the headline, and show total as 'x of N'.
  3. Add unit test asserting passed+inProgress+failed === total.
- **Acceptance:**
  - Test: overall 75 never yields tile sum != list length.
  - Tiles match visible rows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-READINESS-01

### GAP-TENANT-ADMIN-READINESS-03  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — Fix-link logic exists but GATE_META entries define no href, so no Fix link ever renders
- **First-pass claim:** Rows are not actionable: a failing "Compliance Verified" or "Security Hardened" has no link to the screen that fixes it (page.tsx:79-89).
- **Verified evidence:** readiness/page.tsx:79-89 li rows contain icon, text and StatusPill only; no anchor. Existing target routes: tenant-admin/compliance, mfa, settings, sso, idp, install, org-hierarchy, users, etc.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/readiness/page.tsx`
- **Fix steps:**
  1. Add href to each checklist item (e.g. Users->/tenant-admin/users, Security->/tenant-admin/security, Compliance->/tenant-admin/compliance, Integrations->/tenant-admin/idp, Modules->/tenant-admin/settings) once items are data-driven.
  2. Render a 'Fix' link for non-pass rows.
  3. Verify each target exists and is role-permitted.
- **Acceptance:**
  - Failing row shows a link that lands on the right screen.
  - No link 404s (link-check test).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-READINESS-01

### GAP-TENANT-ADMIN-READINESS-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** productionReady and allGreen from the API are typed but never shown, so "go-live" readiness is not stated (loaders.ts:829-833, page.tsx:36).
- **Verified evidence:** loaders.ts TenantAdminReadiness {overall, productionReady, allGreen} (~l.829-833); page.tsx uses only readiness.overall (l.39,42). productionReady is used only in the hub KPI note (loaders ~l.54 'Production ready'/'Gates pending').
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/readiness/page.tsx`
- **Fix steps:**
  1. Add a banner/StatusPill above the tiles: productionReady ? 'Ready for go-live' : 'Not ready for go-live', and allGreen indicator.
  2. Use text, not colour alone.
  3. Handle readiness===null with 'Not available'.
- **Acceptance:**
  - productionReady=false shows 'Not ready' banner.
  - readiness null shows not-available, not 0%.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-READINESS-05  ·  LOW  ·  partly  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Status carried by emoji with aria-hidden plus a pill; progress bar uses DS ProgressBar without a text label beyond the percentage (page.tsx:26-30,72).
- **Verified evidence:** page.tsx:82 emoji is aria-hidden and every row also has StatusPill with text label (l.87), so status is not emoji/colour-only: overstated. Real gaps: ProgressBar (ds/ProgressBar.tsx) renders plain div with no role=progressbar/aria-valuenow, the percentage text is adjacent only; strings hard-coded; StatCard icons are emoji.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/readiness/page.tsx`, `apps/web/src/app/_components/ds/ProgressBar.tsx`
- **Fix steps:**
  1. Add role='progressbar', aria-valuemin/max/now and optional label prop to ProgressBar.
  2. Pass label 'Overall completion' from readiness page.
  3. Move strings to next-intl only if adopted elsewhere.
- **Acceptance:**
  - Screen reader announces 'Overall completion 75%'.
  - ProgressBar unit test asserts aria attributes.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component change affects all ProgressBar users (additive attrs only).


---
## /tenant-admin/roles  —  `tenant-admin/roles.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/roles/page.tsx`
- **Design reference:** `redesign/tenant-admin/roles.html`

### GAP-TENANT-ADMIN-ROLES-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** On fetch failure getAdminRoles returns [] so all four StatCards show 0 and the table shows the generic empty state; only a small badge hints at the failure, so an outage reads as "no roles" (page.tsx:10-16,28-33; loaders.ts:4172).
- **Verified evidence:** roles/page.tsx:10-16 getAdminRoles returns [] on failure (loaders ~4172, fetchJson empty []), so StatCards (l.28-31) show 0 and RolesTable renders empty; only DataSourceBadge when source==='error' (l.33). There is no roles/error.tsx, only parent.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/roles/page.tsx`
- **Fix steps:**
  1. Compute errored via toResourceState(result).status==='error' as in readiness/page.tsx:35.
  2. Show '—' in the four StatCards when errored.
  3. Replace RolesTable with Card + <RefreshErrorState backHref='/tenant-admin'/> when errored; keep badge for cached.
- **Acceptance:**
  - Simulated 500: tiles show '—' and Retry state, no empty table.
  - Genuine empty list still shows the empty table with 0.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-ROLES-02  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Creating a role posts immediately with no reason, unlike permission changes that require an audited reason, though roles gate access (RolesTable.tsx:123-140 vs PermissionGrid.tsx confirm).
- **Verified evidence:** RolesTable.tsx:114-137 ConfirmDialog without requireReason posts {name, description} to /api/proxy/policy/roles; permission save uses requireReason (PermissionGrid.tsx:198). Custom roles have no permissions until edited, so risk is moderate.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/roles/RolesTable.tsx`
- **Fix steps:**
  1. Add requireReason and reasonLabel to NewRoleDialog ConfirmDialog.
  2. Include reason in POST body (align with ROLES-DETAIL-04).
  3. Server emits audit event role.created.
- **Acceptance:**
  - Create cannot submit without reason.
  - Audit shows role creation with reason.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; slight friction.
- **Depends on:** GAP-TENANT-ADMIN-ROLES-DETAIL-04

### GAP-TENANT-ADMIN-ROLES-03  ·  MEDIUM  ·  partly  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** "Assignments" = sum of userCount across roles, so users holding several roles are counted more than once and the tile is not a user count (page.tsx:15,31).
- **Verified evidence:** roles/page.tsx:15 totalAssigned = sum of r.userCount; tile label 'Assignments' (l.31) is accurate as role assignments, but it can be mistaken for users and duplicates users holding several roles. Whether userCount counts distinct users per role is backend detail.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/roles/page.tsx`
- **Fix steps:**
  1. Relabel to 'Role assignments' with a sub-note 'a user with 2 roles counts twice'.
  2. Or replace with distinct-user count from a users endpoint if available.
- **Acceptance:**
  - Tile label/hint clarifies the count semantics.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-ROLES-04  ·  MEDIUM  ·  partly  ·  theme AUTHZ (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** "+ New Role" is rendered for every tenant-admin viewer with no capability check; refusal by the policy service would surface only as a form error (RolesTable.tsx:38-40).
- **Verified evidence:** RolesTable.tsx:37 renders '+ New Role' unconditionally; layout.tsx restricts the route to tenant_admin/platform_admin/super_admin, so all viewers here are admins. A finer capability model (policy permission for role creation) is not exposed in the snapshot (only getSessionRoles in roleGuard.ts), so cannot see who lacks it; 403 surfaces via formError in the dialog (l.126-128).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/roles/RolesTable.tsx`, `apps/web/src/app/(app)/tenant-admin/roles/page.tsx`
- **Fix steps:**
  1. Pass canCreate prop from page.tsx computed from session roles or a capability endpoint if one exists.
  2. Hide/disable button with tooltip when false.
- **Acceptance:**
  - View-only admin sees no New Role button.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-ROLES-05  ·  LOW  ·  confirmed  ·  theme OTHER (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Description is clipped to 200px with ellipsis and no title/tooltip, so full text is unreachable (RolesTable.tsx:46-52). No delete or clone role action exists.
- **Verified evidence:** RolesTable.tsx:53 span maxWidth 200 with ellipsis and no title attribute; DataTable rowHref opens detail where description is shown in full (roles/[id]/page.tsx:51), so reachable via row click. No delete or clone action anywhere in roles/ or roles/[id].
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/roles/RolesTable.tsx`
- **Fix steps:**
  1. Add title={role.description} to the span (or use a DS Tooltip).
  2. Track Delete/Clone role as separate feature decision.
- **Acceptance:**
  - Hover shows full description.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /tenant-admin/roles/[id]  —  `tenant-admin/roles-detail.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/roles/[id]/page.tsx`
- **Design reference:** `redesign/tenant-admin/roles-detail.html`

### GAP-TENANT-ADMIN-ROLES-DETAIL-01  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** The grid offers "Inherit" as a cell state but there is no removal endpoint, so any reset-to-inherit is skipped on save; the dialog admits it only after the user has made the change (PermissionGrid.tsx:73-74,159-168,195-197).
- **Verified evidence:** PermissionGrid.tsx:69 cycle includes 'inherit'; l.79-82 unremovable = changed cells going to inherit; l.89 loop saves only savable; l.103-106 notice reports skipped resets. Confirm dialog l.191-193 states resets will be skipped BEFORE Save is confirmed (so not only after), but the grid hint (l.166-168) still advertises 'Inherit' as a normal step and the button count (l.155) excludes them. Removal endpoint absence is from the code comment; backend cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/roles/[id]/PermissionGrid.tsx`
- **Fix steps:**
  1. Until a DELETE permission endpoint exists, disable the deny->inherit step for cells that have a baseline (cycle allow<->deny only), or mark those cells 'reset unavailable'.
  2. Update hint text accordingly.
  3. When backend adds removal, add DELETE call in save() and drop unremovable path.
- **Acceptance:**
  - Cell with saved Allow cannot be cycled to Inherit while removal is unsupported.
  - Dialog no longer needs the skipped-change warning.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Permissions silently not reverted is an access-control risk.
- **Depends on:** GAP-TENANT-ADMIN-ROLES-DETAIL-02

### GAP-TENANT-ADMIN-ROLES-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Save issues one POST per changed cell in a loop; a failure mid-way leaves earlier cells applied while the draft is retained, so the role can be left half-updated with only one error line (PermissionGrid.tsx:96-111).
- **Verified evidence:** PermissionGrid.tsx:89-100 sequential awaited POST per changed cell; on !res.ok it throws (l.96-98); catch (l.108-110) sets error, keeps draft (setDraft not called) and does not router.refresh, so cells already applied show stale baseline and a retry re-POSTs them. No bulk endpoint referenced; atomicity is backend cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/roles/[id]/PermissionGrid.tsx`
- **Fix steps:**
  1. Preferred: add a single bulk endpoint POST /policy/roles/:id/permissions:batch (backend) and call once.
  2. Interim: on partial failure track succeeded keys, remove them from draft, router.refresh(), and show 'N of M saved; K failed: list'.
  3. Send an idempotency key (x-idempotency-key is forwarded by the proxy) per request.
  4. Show failed cells highlighted.
- **Acceptance:**
  - Mock 2nd of 3 POSTs failing: UI reports 1 saved, 2 not, draft holds only remaining cells.
  - Retry does not repeat succeeded cells.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Half-applied role permissions affects user access.

### GAP-TENANT-ADMIN-ROLES-DETAIL-03  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** A failed fetch (data null, source "error") is rendered as "Role not found." — an outage looks like a deleted role, the confusion fixed for users/[id] under UX-013 (page.tsx:13-21).
- **Verified evidence:** roles/[id]/page.tsx:11-21 `if (!role)` renders 'Role not found.' for null data. getAdminRoleById (loaders ~l.4181) returns null on error (fetchJson empty=null, source 'error'), so 5xx/network and 404 both show not found; source is only used later (l.36). RefreshErrorState exists (ds/RefreshErrorState.tsx).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/roles/[id]/page.tsx`, `apps/web/src/app/(app)/tenant-admin/roles/[id]/not-found.tsx`
- **Fix steps:**
  1. Destructure source/status; if source==='error' and status!==404 render Card + <RefreshErrorState error={toHumanError('load',{area:'role'})} backHref='/tenant-admin/roles'/>.
  2. For status 404 (result.status exists in apiClient) call notFound() with a not-found.tsx.
  3. Keep the Not-found copy only for genuine 404.
- **Acceptance:**
  - Simulated 500: retry error state, not 'Role not found'.
  - Unknown id (404): not-found page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-ROLES-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** The audit reason is sent as the x-correlation-id header truncated to 64 chars, not as a body field, so the "audited" reason may not be stored (PermissionGrid.tsx:100-104).
- **Verified evidence:** PermissionGrid.tsx:91-95 sends reason only as header x-correlation-id sliced to 64 chars; body has {resource, action, effect}. Proxy (app/api/proxy/[...path]/route.ts:7) forwards x-correlation-id, but whether policy-service stores it as audit reason is cannot-verify (service absent). A correlation id is meant for tracing, and long reasons are truncated.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/roles/[id]/PermissionGrid.tsx`
- **Fix steps:**
  1. Confirm policy-service accepts a body `reason` field on POST /roles/:id/permissions; add `reason` to the JSON body (zod-limited to 500 chars).
  2. Stop sending reason as x-correlation-id; let the proxy generate a real correlation id.
  3. Show the full reason in the dialog limit counter.
- **Acceptance:**
  - Request body contains reason; header holds a UUID.
  - Audit log entry displays the full reason.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Audit trail integrity for permission changes.
- **Depends on:** GAP-TENANT-ADMIN-ROLES-DETAIL-02

### GAP-TENANT-ADMIN-ROLES-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Edit role PATCH (rename or re-describe a role that gates access) has no reason or confirmation (EditRoleButton.tsx:50-58). Subtitle promises "user assignments" but only a count is shown, no assigned users (page.tsx:29,49).
- **Verified evidence:** EditRoleButton.tsx:27-46 ConfirmDialog has no requireReason; PATCH body l.54-58 has name+description only. Correct. Subtitle: page.tsx:29 'Role permissions and user assignments' is only a fallback when description is empty; Details card l.49 shows a count only, no assigned users list (no loader for role members seen).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/roles/[id]/EditRoleButton.tsx`, `apps/web/src/app/(app)/tenant-admin/roles/[id]/page.tsx`
- **Fix steps:**
  1. Add requireReason and reasonLabel to the ConfirmDialog and send reason in the PATCH body (or header per -04 decision).
  2. Change fallback subtitle to 'Role permissions' or add a members list linked to /tenant-admin/users filtered by role.
  3. Emit audit event server side.
- **Acceptance:**
  - Edit dialog cannot be submitted without a reason.
  - Fallback subtitle matches content.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Renaming roles affects perceived access; keep reason min length consistent.
- **Depends on:** GAP-TENANT-ADMIN-ROLES-DETAIL-04


---
## /tenant-admin/security  —  `tenant-admin/security.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/security/page.tsx`
- **Design reference:** `redesign/tenant-admin/security.html`

### GAP-TENANT-ADMIN-SECURITY-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** The four posture tiles are not links and the page has no drill-through: Active Sessions, Failed Logins and MFA Adoption each have a dedicated screen (sessions, audit, mfa) but the only outbound link is "View full audit log" (page.tsx:26-31,34).
- **Verified evidence:** security/page.tsx:27-30 four StatCards with no link; only link is 'View full audit log' (l.34,38,42). Routes tenant-admin/sessions, mfa, audit exist. Check whether StatCard supports href (ds/StatCard.tsx) before use.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/security/page.tsx`, `apps/web/src/app/_components/ds/StatCard.tsx`
- **Fix steps:**
  1. Add optional href prop to StatCard (renders anchor, min 44px) if not present.
  2. Link Active Sessions->/tenant-admin/sessions, Failed Logins->/tenant-admin/audit (filter for login failures if supported), MFA->/tenant-admin/mfa; Trusted Devices has no dedicated route (leave plain).
  3. Keyboard focus styling.
- **Acceptance:**
  - Each linked tile navigates to the right page via keyboard.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-SECURITY-02  ·  MEDIUM  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** mapResponse only checks isRecord, so an API payload without "events" makes overview.events.length throw and drops to error.tsx instead of the friendly error card (loaders.ts:4627-4640, page.tsx:37).
- **Verified evidence:** loaders.ts getSecurityOverview mapResponse: isRecord(p) ? p as SecurityOverview : null (~l.4627-4640), no field validation. Payload without events -> overview.events undefined -> page.tsx:37 overview.events.length throws; security/error.tsx catches (exists), not the friendly Card. Same for numeric fields rendering undefined.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/tenant-admin/security/page.tsx`
- **Fix steps:**
  1. Define SecurityOverviewSchema in zod (numbers, events array default []) and use as responseSchema, as getAdminRoles does.
  2. Return null from mapResponse when invalid so source becomes error.
  3. Add unit test for missing-events payload.
- **Acceptance:**
  - Payload {} yields RefreshErrorState card, not error.tsx.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-SECURITY-04  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-08 #2012 (export is permission-gated and fail-closed audited): closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Actor emails and source IPs are personal data yet are exportable to CSV with no masking or export audit (SecurityTable.tsx:20-38).
- **Verified evidence:** SecurityTable.tsx:23-24,32-33 shows actor and ipAddress unmasked and DataTable exportable=true exports CSV client-side (ds/DataTable.tsx:311) with no audit call. No <Masked> component exists in ds (only unrelated 'Masked' in admin/integrations). Server-side CSV audit endpoint cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/security/SecurityTable.tsx`, `apps/web/src/app/_components/ds/Masked.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Create ds/Masked (mask email/IP, reveal button for privileged role, POST audit event on reveal).
  2. Use for actor and ipAddress columns.
  3. Add onExport callback prop to DataTable that fires an audit event (POST via proxy) and pass it here; or drop exportable.
  4. Export masked values unless revealed.
- **Acceptance:**
  - CSV export logs an audit event and contains masked values by default.
  - Reveal action recorded.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure of PII; role decision on who may reveal.

### GAP-TENANT-ADMIN-SECURITY-05  ·  LOW  ·  confirmed  ·  theme I18N (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Timestamps use toLocaleString("en-IN") on the client, so the column can differ between server render and browser; the event "type" column prints raw codes (SecurityTable.tsx:21-22).
- **Verified evidence:** SecurityTable.tsx:21 new Date().toLocaleString('en-IN',{dateStyle,timeStyle}) in a 'use client' component that is also SSR'd: server timezone vs browser timezone can differ, causing hydration mismatch warnings. Column 'type' (l.22) prints raw codes.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/security/SecurityTable.tsx`
- **Fix steps:**
  1. Use shared formatter from @/lib/formatters (formatIndianDate style) with explicit timeZone 'Asia/Kolkata'.
  2. Add EVENT_LABELS map with fallback to raw code.
- **Acceptance:**
  - Render under TZ=UTC and TZ=Asia/Kolkata gives same string with no hydration warning.
  - Known event codes show labels.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /tenant-admin/sessions  —  `tenant-admin/sessions.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/sessions/page.tsx`
- **Design reference:** `redesign/tenant-admin/sessions.html`

### GAP-TENANT-ADMIN-SESSIONS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Failure returns [] so KPIs read 0 and the log shows the generic empty state; only a small badge signals the error (page.tsx:9-15,31; loaders.ts:4298).
- **Verified evidence:** sessions/page.tsx:9 destructures {data,source}; getActiveSessions (loaders.ts:4298-4305) falls back to []. Tiles (page.tsx:11-14,26-29) then show 0 and SessionsTable renders DataTable empty; the only cue is DataSourceBadge at page.tsx:31. Sibling pages (siem, sso, idp) already use toResourceState + RefreshErrorState.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/sessions/page.tsx`
- **Fix steps:**
  1. In page.tsx import toResourceState (@/app/_data/useResource), RefreshErrorState (ds), toHumanError (@/lib/messages).
  2. Compute errored = toResourceState(result).status==='error'.
  3. Pass "—" to the four StatCards when errored (as siem/page.tsx:30-33 does).
  4. When errored render <Card title='Session log'><RefreshErrorState error={toHumanError('load',{area:'sessions'})} backHref='/tenant-admin'/></Card> instead of <SessionsTable>; drop the standalone DataSourceBadge.
- **Acceptance:**
  - Component/manual: mock getActiveSessions to return source 'error' -> tiles show '—', RefreshErrorState visible, no 'Session log' empty table.
  - Healthy empty list -> tiles 0 and empty table.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentational only.
- **Depends on:** RefreshErrorState

### GAP-TENANT-ADMIN-SESSIONS-02  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Rows do not link to sessions/[id], so the detail route is unreachable from the list (and that route is itself a static mock) (SessionsTable.tsx:107-152).
- **Verified evidence:** SessionsTable.tsx:87-138 has no link/href in any column (only a Revoke button, lines 123-135). sessions/[id]/page.tsx exists but is a hardcoded mock (const session = {userName:'Rajesh Verma', ipAddress:'10.0.2.45',...} at lines 37-51, plus PlaceholderButton), so it is both unreachable and fake.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/sessions/SessionsTable.tsx`, `apps/web/src/app/(app)/tenant-admin/sessions/[id]/page.tsx`
- **Fix steps:**
  1. Decide: either delete sessions/[id] or wire it to real data. Preferred: delete the mock route (page/loading/error) and keep the list-only design.
  2. If keeping, add a getSessionDetail loader against the identity sessions API (endpoint shape not visible here; confirm with identity-service) and remove the hardcoded const.
  3. Then make the User cell in SessionsTable a <Link href={`/tenant-admin/sessions/${s.id}`}>.
- **Acceptance:**
  - Route /tenant-admin/sessions/sess-a1b2c3d4 no longer renders fabricated data (404 or real data).
  - If linked: clicking a row user opens detail of that exact session id.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; removing fabricated PII-looking sample data is a net gain.

### GAP-TENANT-ADMIN-SESSIONS-03  ·  MEDIUM  ·  partly  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** "Suspicious" is any active session without MFA, and "Locations" counts distinct first-two-octet prefixes, so private 10.x sessions always collapse to one and neither tile means what its label says (page.tsx:12-14).
- **Verified evidence:** page.tsx:14 suspicious = active && !mfaVerified (true, mislabelled). page.tsx:12 locations = distinct first-two-octet prefixes; overstated: 10.0.x and 10.1.x count as different, but SessionsTable.locationLabel (36-35 region, lines 31-35) collapses all 10./172./192.168. to 'Internal network', so tile and column disagree and it is not a geographic location. Strings are hardcoded English (no next-intl in these files).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/sessions/page.tsx`, `apps/web/src/app/(app)/tenant-admin/sessions/SessionsTable.tsx`
- **Fix steps:**
  1. Rename tile 'Suspicious' -> 'Active without MFA' (or compute real risk only if backend supplies a flag) and 'Locations' -> 'Distinct networks'; or drop Locations.
  2. Reuse locationLabel logic (extract to a helper in sessions/ or lib) so tile and column count identically.
  3. Move tile labels to next-intl keys if the project namespace exists for tenant-admin; otherwise leave for the i18n sweep.
- **Acceptance:**
  - Unit test: 3 active sessions, 2 without MFA -> tile shows 2 labelled 'Active without MFA'.
  - Sessions from 10.0.1.1 and 10.1.1.1 count as one 'Internal network'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-SESSIONS-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** "Last active" uses formatIndianDate (date only) on a security screen where the time of activity matters; no marker for the admin's own current session, so it can be revoked (SessionsTable.tsx:127).
- **Verified evidence:** SessionsTable.tsx:113 renders formatIndianDate(s.lastActiveAt); that helper (lib/formatters.ts:2-7) is date-only dd/MM/yyyy, so no time. No column or prop identifies the caller's own session: page.tsx maps only id,userEmail,userName,ipAddress,userAgent,lastActiveAt,mfaVerified,status (33-42), and Revoke shows for every active row (128-133). Whether identity-service rejects self-revocation is not visible (cannot verify).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/sessions/SessionsTable.tsx`, `apps/web/src/app/(app)/tenant-admin/sessions/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatIndianDateTime(iso) to lib/formatters.ts (Asia/Kolkata, 'dd/MM/yyyy HH:mm') and use it at SessionsTable.tsx:113.
  2. Read the caller's session id/user email from the existing auth session helper on the server page and pass currentSessionId (or currentUserEmail) into SessionsTable.
  3. Render a 'This session' pill and hide/disable Revoke for that row (or warn in ConfirmDialog description).
- **Acceptance:**
  - Row with lastActiveAt 2026-09-01T09:05:00Z shows '01/09/2026 14:35'.
  - Current admin's session row shows 'This session' and no active Revoke button.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: locking oneself out; backend should also refuse self-revoke.

### GAP-TENANT-ADMIN-SESSIONS-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Filter offers All/Active/Revoked but Expired rows appear only under All; device and location are best-effort parses of UA and IP prefix (SessionsTable.tsx:20-36).
- **Verified evidence:** SessionsTable.tsx:20 FILTERS=['All','Active','Revoked'] while Session.status includes 'expired' (line 17) and rows filter by lowercase status (46-49), so Expired rows are only visible under All. deviceLabel (23-28) and locationLabel (31-35) are UA regex / IP-prefix heuristics, as stated.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/sessions/SessionsTable.tsx`
- **Fix steps:**
  1. Add 'Expired' to FILTERS.
  2. Label the column 'Network' rather than 'Location' (see SESSIONS-03) and show raw UA in a title attribute for unknown devices.
- **Acceptance:**
  - Selecting Expired shows only expired rows.
  - Column header reads 'Network'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-SESSIONS-03


---
## /tenant-admin/sessions/[id]  —  `tenant-admin/sessions-detail.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/sessions/[id]/page.tsx`
- **Design reference:** `redesign/tenant-admin/sessions-detail.html`

### GAP-TENANT-ADMIN-SESSIONS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Every session id renders the same hard-coded session (Rajesh Verma, 15 Jan 2025); the route never fetches and never uses params.id for data, so an admin reading it sees another person's details (page.tsx:21-35,49).
- **Verified evidence:** sessions/[id]/page.tsx:21-35 const session (Rajesh Verma, 2025-01-15) is rendered for every params.id; params.id is used only in the breadcrumb (l.49). No fetch. Loader for list exists (getActiveSessions, loaders ~4298 GET /api/identity/sessions) but no by-id loader; GET /identity/sessions/:id existence cannot-verify. SessionSummary lacks os/browser/location fields shown here.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/sessions/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add getSessionById(id) loader; if no by-id endpoint, find in getActiveSessions() result by id, else backend needed.
  2. Delete the constant; render only fields present (userName, userEmail, ipAddress, userAgent, lastActiveAt, mfaVerified, status); derive device/browser from userAgent via shared deviceLabel from SessionsTable.
  3. Return notFound() for 404 and RefreshErrorState for error.
  4. Drop fabricated os/location fields.
- **Acceptance:**
  - /sessions/<real id> shows that user's data; unknown id -> not found.
  - No hard-coded name remains in bundle.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Displays another person's identity to admin: data-integrity/privacy.

### GAP-TENANT-ADMIN-SESSIONS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** "Revoke Session" is a disabled coming-soon button even though DELETE /identity/sessions/:id is already used by the list page (page.tsx:55; SessionsTable.tsx:49).
- **Verified evidence:** sessions/[id]/page.tsx:55 PlaceholderButton 'Revoke Session' disabled; SessionsTable.tsx:57-61 already does DELETE /api/proxy/identity/sessions/:id with reason and ConfirmDialog requireReason (l.151).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/sessions/[id]/page.tsx`, `apps/web/src/app/(app)/tenant-admin/sessions/[id]/RevokeButton.tsx`, `apps/web/src/app/(app)/tenant-admin/sessions/SessionsTable.tsx`
- **Fix steps:**
  1. Extract revoke logic from SessionsTable into shared useRevokeSession/RevokeSessionDialog.
  2. Create client RevokeButton for detail page with ConfirmDialog requireReason, redirecting to /tenant-admin/sessions after success.
  3. Hide when status !== 'active'; disable for current admin's own session if identifiable.
- **Acceptance:**
  - Revoke with reason on detail page returns to list showing Revoked.
  - Non-active session has no button.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Session termination is disruptive; keep reason and audit.
- **Depends on:** GAP-TENANT-ADMIN-SESSIONS-DETAIL-01

### GAP-TENANT-ADMIN-SESSIONS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** The list page has no link to this route, so it is unreachable in normal navigation (SessionsTable.tsx:107-152).
- **Verified evidence:** SessionsTable.tsx:87-138 DataTable for sessions has no rowHref (unlike RolesTable.tsx:41). No other link to /tenant-admin/sessions/[id] in the list page.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/sessions/SessionsTable.tsx`
- **Fix steps:**
  1. Add rowHref={(s)=>`/tenant-admin/sessions/${s.id}`} (ensure Revoke button click doesn't trigger navigation) or a 'View' link in Actions.
  2. Do only after -01 makes the page real.
- **Acceptance:**
  - Clicking row opens detail; Revoke still opens dialog.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-SESSIONS-DETAIL-01

### GAP-TENANT-ADMIN-SESSIONS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** No not-found or error handling and no loading state that reflects data, because nothing loads; MFA shown as "Yes ✅" emoji and raw status string via StatusPill (page.tsx:64-65).
- **Verified evidence:** Page is sync with no loader, so no not-found or data error path (page.tsx:46). Correction: sessions/[id]/error.tsx and loading.tsx exist. l.64 'Yes ✅'/'No ❌' has text; l.65 StatusPill given raw status string (tones for active/revoked/expired should be checked in ds/StatusPill.tsx).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/sessions/[id]/page.tsx`
- **Fix steps:**
  1. After -01, add not-found/error branches.
  2. Replace emoji strings with StatusPill tones 'Verified'/'Not verified'.
  3. Map status to labelled pill as SessionsTable does (Active/Revoked/Expired).
- **Acceptance:**
  - Unknown id shows not found.
  - MFA cell has no emoji.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-SESSIONS-DETAIL-01

### GAP-TENANT-ADMIN-SESSIONS-DETAIL-05  ·  LOW  ·  partly  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0-10 note:** review found the W0 tick partly — sessions/[id]/page.tsx:93 IP masked via maskIp (no clear IP shown), but no reveal and no audited reveal/view event (acceptance "reveal audited" unmet; deliberate per comment :14); full userAgent still printed :106.
- **First-pass claim:** Full user agent and IP are printed for any viewer; personal-data handling (DPDP) and access audit are not addressed (page.tsx:73,84-86).
- **Verified evidence:** page.tsx:73,85 print ipAddress and full userAgent to any viewer; the route is restricted by layout.tsx to tenant/platform/super admins, so not 'any viewer'. Values are hard-coded today so nothing real leaks; once real data is bound, IP is PII under DPDP and no access audit exists. List page shows full IP too (SessionsTable.tsx:109).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/sessions/[id]/page.tsx`, `apps/web/src/app/_components/ds/Masked.tsx`
- **Fix steps:**
  1. After -01, render IP through shared <Masked> (see SECURITY-04) with reveal + audit.
  2. Log a view event server-side if policy requires.
- **Acceptance:**
  - IP masked by default with reveal audited.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** DPDP compliance; decide policy on admin IP visibility.
- **Depends on:** GAP-TENANT-ADMIN-SESSIONS-DETAIL-01, GAP-TENANT-ADMIN-SECURITY-04


---
## /tenant-admin/settings  —  `tenant-admin/settings.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/settings/page.tsx`
- **Design reference:** `redesign/tenant-admin/settings.html`

### GAP-TENANT-ADMIN-SETTINGS-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — Dead banner removed; decision recorded that no workflow endpoint exists, direct toggle with confirm+reason; no approval flow
- **First-pass claim:** ModuleApprovalBanner (tenant_admin "Approval required", workflow-service request) is dead code; the page lets a tenant_admin toggle modules directly with no approval or confirmation, contradicting the documented workflow (ModuleApprovalBanner.tsx:8-15, ModuleToggleActions.tsx:44-52).
- **Verified evidence:** grep finds no import of ModuleApprovalBanner anywhere in apps/web/src (only its own file), so it is dead. Its doc (ModuleApprovalBanner.tsx:18-26) says tenant_admin must POST /api/proxy/v1/workflow/module-change-requests, but ModuleToggleActions.save (46-70) POSTs /api/proxy/v1/admin/tenant/modules/{key}/toggle directly for any role; ModuleToggleActions never receives roles. Whether workflow-service or the admin toggle endpoint enforces approval server-side is not in the snapshot (cannot verify backend).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/settings/ModuleToggleActions.tsx`, `apps/web/src/app/(app)/tenant-admin/settings/page.tsx`, `apps/web/src/app/(app)/tenant-admin/settings/ModuleApprovalBanner.tsx`
- **Fix steps:**
  1. In settings/page.tsx read the session roles server-side (use the existing auth/session helper used by other pages) and pass roles to ModuleToggleActions.
  2. In ModuleToggleActions render <ModuleApprovalBanner roles dirtyKeys={dirtyKeys} pendingState={pending}/> above the Save button.
  3. For non-super/platform admins, hide 'Save changes' (or make it submit via the banner's request flow); keep direct toggle only for super_admin/platform_admin.
  4. Extend the banner request to include a user-entered reason (currently hardcoded string at line 49).
  5. Backend: confirm admin-service toggle endpoint rejects tenant_admin (403) so UI is not the only gate.
- **Acceptance:**
  - As tenant_admin: toggling a module shows 'Approval required' and Save is replaced by Request Approval; toggle endpoint is not called.
  - As super_admin: banner says direct access; save works.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: governance control; module disable affects entire tenant.
- **Depends on:** GAP-TENANT-ADMIN-SETTINGS-02

### GAP-TENANT-ADMIN-SETTINGS-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Disabling a module (Finance, HR) applies on "Save changes" with no confirm dialog and no reason field; other destructive admin actions require an audited reason (ModuleToggleActions.tsx:44-63).
- **Verified evidence:** ModuleToggleActions.tsx:46-70 save() loops dirtyKeys and POSTs {enabled} only; there is no ConfirmDialog and no reason field. Contrast: sessions/SessionsTable.tsx:140-157 uses ConfirmDialog with requireReason. Audit is claimed server-side (file comment lines 20-22), not verifiable here. Maker!=checker is only meaningful with the approval flow in SETTINGS-01.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/settings/ModuleToggleActions.tsx`
- **Fix steps:**
  1. Import ConfirmDialog from ds; clicking Save opens it listing modules being disabled/enabled (danger variant if any disable).
  2. Use requireReason and send {enabled, reason} in the toggle body.
  3. Only call save() from onConfirm; show busy/errorMessage props as SessionsTable does.
  4. Backend: accept reason and write it into the audit event.
- **Acceptance:**
  - Click Save with Finance turned off -> dialog appears; confirm disabled until reason meets minimum length.
  - Request body contains reason; cancel makes no request.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: disabling a module cuts user access; backend must accept the new reason field.
- **Depends on:** GAP-TENANT-ADMIN-SETTINGS-01

### GAP-TENANT-ADMIN-SETTINGS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Save loops over changed modules and stops at the first failure, leaving earlier toggles applied while the UI shows only the error text (ModuleToggleActions.tsx:44-58).
- **Verified evidence:** ModuleToggleActions.tsx:52-62: sequential fetch per key; on the first !res.ok it sets error and returns (finally resets busy) without router.refresh(), so earlier toggles are persisted server-side while local `pending` state still shows all intended toggles and `initial` is stale; no list of which succeeded.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/settings/ModuleToggleActions.tsx`
- **Fix steps:**
  1. Track results per key (succeeded[], failed key) inside save().
  2. On any failure still call router.refresh() so server state reloads, and report 'Saved N of M; <module> failed: <msg>'.
  3. Optionally continue remaining keys with Promise.allSettled and list failures.
- **Acceptance:**
  - Mock the 2nd of 3 requests to 500: message names saved and failed modules; after refresh the 1st shows new state and 2nd/3rd remain dirty.
  - All success behaves as before.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; better to prefer a backend bulk endpoint later.

### GAP-TENANT-ADMIN-SETTINGS-04  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Status vocabulary is inconsistent: toggle pill "Active/Disabled", details table "Active/Inactive", tile "Disabled"; "Configured" always equals Total Modules so it carries no information (ModuleToggleActions.tsx:98, page.tsx:31,50).
- **Verified evidence:** Toggle pill text 'Active'/'Disabled' (ModuleToggleActions.tsx:100), details table 'Active'/'Inactive' (page.tsx:50), tile 'Disabled' (page.tsx:31). 'Configured' tile is value={total} (page.tsx:32, not 31), identical to Total Modules. StatusPill maps 'inactive' to mut (StatusPill.tsx:22) but 'disabled' is not in STATUS_MAP.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/settings/page.tsx`, `apps/web/src/app/(app)/tenant-admin/settings/ModuleToggleActions.tsx`
- **Fix steps:**
  1. Pick one vocabulary (Enabled/Disabled) and use it in the pill, table status and tile.
  2. Remove the 'Configured' tile or replace it with a meaningful metric (e.g. modules included in plan) if data exists.
- **Acceptance:**
  - Grep of settings page shows a single vocabulary.
  - Only three tiles unless a real fourth metric is bound.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-SETTINGS-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch resolves to [], so tiles show 0 and the card says "No modules"; only a badge distinguishes outage from empty (page.tsx:9-12,34).
- **Verified evidence:** getTenantModules (loaders.ts:4190) presumably falls back to []; page.tsx:9-13 does no error check, tiles 29-32 read 0, ModuleToggleActions shows EmptyState 'No modules' (line 106), and only DataSourceBadge at page.tsx:34 signals failure.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/settings/page.tsx`, `apps/web/src/app/(app)/tenant-admin/settings/ModuleToggleActions.tsx`
- **Fix steps:**
  1. Use toResourceState on the loader result.
  2. When errored: tiles '—', render RefreshErrorState card instead of ModuleToggleActions and details table.
  3. Also disable toggles in that state.
- **Acceptance:**
  - Force source 'error' -> RefreshErrorState shown, no 'No modules' text, no Save button.
  - Empty success -> 'No modules' still shown.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-SESSIONS-01

### GAP-TENANT-ADMIN-SETTINGS-06  ·  LOW  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — Switch now track+thumb with state text; audit link still unfiltered (audit page has no filter params)
- **First-pass claim:** Toggle is a pill-styled button (role=switch) whose text is the state, not the action; the "Audit changes" link is to the whole audit log, not filtered to module changes (page.tsx:24).
- **Verified evidence:** Switch is <button role=switch> with aria-label reflecting state (ModuleToggleActions.tsx:90-101), visible text is the current state, which is valid switch semantics though not action-labelled; a11y is acceptable but visually ambiguous. 'Audit changes' href=/tenant-admin/audit (page.tsx:24) is unfiltered; the audit page (audit/page.tsx) takes no searchParams and has only a PlaceholderButton Filter, so a filtered link is not possible today.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/settings/page.tsx`, `apps/web/src/app/(app)/tenant-admin/audit/page.tsx`
- **Fix steps:**
  1. Style the toggle as a real switch (track+thumb) with visible state text beside it.
  2. Either implement resource/action filter params on the audit page, then link ?resource=tenant_module, or rename the link 'View audit log'.
- **Acceptance:**
  - Toggle shows on/off graphic and label; screen reader still announces on/off.
  - Audit link opens filtered results (if filter built).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /tenant-admin/siem  —  `tenant-admin/siem.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/siem/page.tsx`
- **Design reference:** `redesign/tenant-admin/siem.html`

### GAP-TENANT-ADMIN-SIEM-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — Subtitle made honest; still no blocked-IP list or ack/resolve actions
- **First-pass claim:** Subtitle promises "blocked IPs … and security alert management" but the page is a read-only list: no blocked-IP list, no acknowledge/resolve/assign action and rows are not clickable (page.tsx:19-23; SiemTable.tsx:20-37).
- **Verified evidence:** siem/page.tsx:22 subtitle promises blocked IPs and alert management. Page only renders four stat cards and SiemTable (DataTable with sort/filter/export, SiemTable.tsx:26-41): no blocked-IP data source, no row click or action. loaders.ts only exposes getSiemAlerts (/api/v1/admin/siem/alerts).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/siem/page.tsx`, `apps/web/src/app/(app)/tenant-admin/siem/SiemTable.tsx`
- **Fix steps:**
  1. Change subtitle to describe what exists ('Security alerts detected for this tenant').
  2. If alert workflow is wanted, add an Actions column (Acknowledge / Resolve) calling a backend endpoint with ConfirmDialog+reason; needs new API (not visible here).
- **Acceptance:**
  - Subtitle no longer mentions blocked IPs unless a blocked-IP list is rendered.
  - If actions added: acknowledging an alert changes its status after refresh and is audited.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low for copy fix; actions need backend.

### GAP-TENANT-ADMIN-SIEM-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Critical and high alerts share the same red pill, so the most urgent severity cannot be told apart by colour (SiemTable.tsx:9-12).
- **Verified evidence:** SiemTable.tsx:9-10 both critical and high return 'bad'. The pill still prints the word (line 30) so it is distinguishable by text, but not by colour/weight.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/siem/SiemTable.tsx`
- **Fix steps:**
  1. Add distinct tone for critical (e.g. filled/darker 'bad' variant or a leading icon) and keep high as 'warn'/'bad'; shift medium to 'warn', low to 'info'.
  2. Sort severity by rank not alphabetically.
- **Acceptance:**
  - Critical and high pills render different classes.
  - Sort by severity orders critical>high>medium>low.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-SIEM-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Status pill treats any unknown status as amber "warn" and only "active" as red; "investigating" and "new" look identical, and KPI "Active Alerts" counts only active+investigating (SiemTable.tsx:29; page.tsx:14).
- **Verified evidence:** SiemTable.tsx:32 (not 29): good for resolved/mitigated/blocked, bad only for 'active', everything else (investigating, new, unknown) warn. page.tsx:14 activeAlerts counts active|investigating, excluding 'new'/'open'. SiemAlert.status is an open string (loaders.ts:4562).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/siem/SiemTable.tsx`, `apps/web/src/app/(app)/tenant-admin/siem/page.tsx`
- **Fix steps:**
  1. Define a status enum/const map (new, active, investigating, mitigated, resolved, blocked) shared by table and KPI.
  2. Give each a tone and use humanizeStatus for label; include 'new' in Active Alerts.
  3. Confirm allowed status values with admin-service.
- **Acceptance:**
  - Unit test on the map: each known status yields expected tone; unknown falls to neutral, not warn.
  - KPI counts new+active+investigating.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-SIEM-04  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** (W1 SF-08: closed by #2012)
- **W0 note:** partly fixed by #1864 — Export audit beacon added in web, but no siem/alerts/export-audit endpoint found in services
- **First-pass claim:** Alert titles and source may carry IPs/usernames (personal data under DPDP) and the table exports to CSV with no audit of the export (SiemTable.tsx:31-37).
- **Verified evidence:** DataTable exportable is on (SiemTable.tsx:39) and downloadCsv (DataTable.tsx:274-287) is a client-side Blob with no audit call. Title and source are rendered raw (line 29,31). No evidence in the snapshot that they contain personal data; that is plausible but unverified. No <Masked> component exists in app/_components. Access to the page itself is presumably role-gated by the tenant-admin layout.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/siem/SiemTable.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Add an optional onExport callback prop to DataTable that fires before download.
  2. In SiemTable pass onExport that POSTs an audit event via the proxy (needs backend endpoint) or disable export for non-privileged roles.
  3. Confirm with backend whether alert title/source contain IP/username; if so create a shared Masked component and use for source.
- **Acceptance:**
  - Clicking export triggers an audit record with page, row count and actor.
  - Non-privileged role does not see Export.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: DPDP exposure; audit endpoint needed.

### GAP-TENANT-ADMIN-SIEM-05  ·  LOW  ·  confirmed  ·  theme COPY (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** "Real-time" in the subtitle contradicts a 30 s revalidate window and no refresh control; severity and status are raw lowercase strings (loaders.ts:4566-4570).
- **Verified evidence:** Subtitle 'Real-time' at siem/page.tsx:22 while getSiemAlerts uses revalidateSeconds:30 (loaders.ts:4568) and there is no refresh control. Severity/status rendered raw lowercase (SiemTable.tsx:30,32). Not a validation issue.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/siem/page.tsx`, `apps/web/src/app/(app)/tenant-admin/siem/SiemTable.tsx`
- **Fix steps:**
  1. Replace 'Real-time' with 'Near real-time (refreshes every 30 seconds)'.
  2. Render labels with humanizeStatus; optionally add a router.refresh button.
- **Acceptance:**
  - Subtitle updated.
  - Severity shows 'Critical' not 'critical'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-SIEM-03


---
## /tenant-admin/sso  —  `tenant-admin/sso.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/sso/page.tsx`
- **Design reference:** `redesign/tenant-admin/sso.html`

### GAP-TENANT-ADMIN-SSO-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — Circular links removed, page documented read-only; no add/edit provider (backend 501)
- **First-pass claim:** The two provider screens point at each other: "Configure IDP" here opens /tenant-admin/idp and that page's "Add Provider" opens /tenant-admin/sso, so no screen actually adds or edits a provider (page.tsx:24,46; idp/page.tsx:24).
- **Verified evidence:** sso/page.tsx:24 'Configure IDP' -> /tenant-admin/idp and :46 empty-state action -> /tenant-admin/idp; idp/page.tsx:23 'Add Provider' -> /tenant-admin/sso and :50 likewise. The idp folder contains only IdpTable/page/loading/error and no create/edit form, so no screen adds a provider.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/sso/page.tsx`, `apps/web/src/app/(app)/tenant-admin/idp/page.tsx`, `apps/web/src/app/(app)/tenant-admin/idp/IdpTable.tsx`
- **Fix steps:**
  1. Decide canonical screen (merge sso and idp or keep one as list, one as form).
  2. Create a provider form route (e.g. idp/new) with zod-validated fields posting through /api/proxy to the admin idp endpoint (confirm endpoint with backend).
  3. Point both 'Add/Configure' buttons at the new route; remove the circular links.
- **Acceptance:**
  - Clicking Add Provider on either page opens a form, never the other list.
  - Submitting a valid provider creates it and appears in the list.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Medium: SSO misconfiguration can lock users out; needs test connection.

### GAP-TENANT-ADMIN-SSO-02  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** "Last Sync" tile is the literal "Recent" whenever any provider exists — it is not derived from lastSync, so a provider that stopped syncing days ago still reads "Recent" (page.tsx:33).
- **Verified evidence:** sso/page.tsx:33 value={!errored && providers.length>0 ? 'Recent' : '—'}; SsoProvider.lastSync exists (loaders.ts:4528) but is not used. Same pattern in idp/page.tsx:37.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/sso/page.tsx`, `apps/web/src/app/(app)/tenant-admin/idp/page.tsx`
- **Fix steps:**
  1. Compute latest = max(new Date(p.lastSync)) over valid dates.
  2. Show relative or dd/MM/yyyy HH:mm via formatter, or '—' when none.
  3. Apply same in idp/page.tsx.
- **Acceptance:**
  - Provider synced 5 days ago shows that date, not 'Recent'.
  - No valid lastSync shows '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-SSO-04

### GAP-TENANT-ADMIN-SSO-03  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — Icon/unused vars cleaned; rows still have no edit/disable/test actions
- **First-pass claim:** Rows carry no actions (edit, disable, test connection, delete) and are not links; "Total Providers" uses a users icon and totalUsers is computed but never used (page.tsx:14,31).
- **Verified evidence:** SsoTable.tsx:11-26 columns are Name, Protocol, Entity ID, Status, Last Sync only; no actions or links. sso/page.tsx:31 'Total Providers' uses icon 👥; line 14 totalUsers is computed but unused; DataTable, StatusPill and SsoProvider imports at line 1/3 are unused.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/sso/page.tsx`, `apps/web/src/app/(app)/tenant-admin/sso/SsoTable.tsx`
- **Fix steps:**
  1. Delete totalUsers and unused imports; change icon to 🔗.
  2. Add row actions (Edit, Test connection, Disable) only when the backend endpoints exist; otherwise state read-only in subtitle.
- **Acceptance:**
  - Lint has no unused-var warning for sso/page.tsx.
  - If actions added: each calls a proxy endpoint with ConfirmDialog for disable.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-SSO-01

### GAP-TENANT-ADMIN-SSO-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** lastSync is formatted with new Date(row.lastSync) unguarded, so a provider never synced renders "Invalid Date" (SsoTable.tsx:22).
- **Verified evidence:** SsoTable.tsx:17 (not 22): new Date(row.lastSync).toLocaleString(...) with no guard. undefined/'' -> 'Invalid Date'; null -> 1 Jan 1970. SsoProvider.lastSync is typed string but backend may omit it.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/sso/SsoTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatIndianDateTime(iso) that returns '—' for falsy/invalid input (IST).
  2. Use it in SsoTable render (and IdpTable if same).
- **Acceptance:**
  - lastSync undefined/null/'garbage' renders '—'.
  - Valid ISO renders IST date and time.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-SSO-05  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** "Protocols: SAML / OIDC" is a static tile not reflecting configured protocols; Status via StatusPill prints the raw status string (page.tsx:32; SsoTable.tsx:21).
- **Verified evidence:** Protocols tile is static 'SAML / OIDC' (sso/page.tsx:32) - true. Status uses StatusPill (SsoTable.tsx:16), which now humanizes via humanizeStatus (StatusPill.tsx:61), so it does not print the raw string; but unknown statuses fall to 'info' tone.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/sso/page.tsx`
- **Fix steps:**
  1. Derive protocols from distinct p.protocol values (or drop tile).
  2. Add any real SSO statuses (e.g. 'error','disabled') to STATUS_MAP.
- **Acceptance:**
  - Tile shows 'OIDC' when only OIDC providers exist.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /tenant-admin/subscription  —  `tenant-admin/subscription.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/subscription/page.tsx`
- **Design reference:** `redesign/tenant-admin/subscription.html`

### GAP-TENANT-ADMIN-SUBSCRIPTION-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** A failed fetch (data null) renders the same "No subscription data — unavailable" card as a tenant with no subscription; the only difference is a small badge, and both header actions stay live (page.tsx:33-34,84-88).
- **Verified evidence:** subscription/page.tsx:33 badge only when source==='error'; :84-88 the else branch shows EmptyState 'No subscription data / unavailable' for both null-on-error and genuine none. Header actions (28-29) always render.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/subscription/page.tsx`
- **Fix steps:**
  1. Use toResourceState; when errored render RefreshErrorState (ds) and hide Download invoice/Upgrade.
  2. Keep EmptyState only for source 'api' with null data, with copy 'No active subscription' and a link to plans.
- **Acceptance:**
  - Force error -> retry state, no header actions.
  - API null -> 'No active subscription' empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-SESSIONS-01

### GAP-TENANT-ADMIN-SUBSCRIPTION-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Two different upgrade destinations: this page sends to /billing/plans while the Usage page sends to /tenant-admin/plans (page.tsx:29; usage/UsageDisplay.tsx:88).
- **Verified evidence:** subscription/page.tsx:29 -> /billing/plans, which (billing/plans/page.tsx) is the platform 'Billing - Plans' admin list with '+ New Plan'; usage/UsageDisplay.tsx:86 -> /tenant-admin/plans, the tenant compare/upgrade page (tenant-admin/plans/page.tsx). The tenant-admin one is the right target.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/subscription/page.tsx`, `apps/web/src/app/(app)/tenant-admin/usage/UsageDisplay.tsx`
- **Fix steps:**
  1. Change subscription Upgrade href to /tenant-admin/plans.
  2. Export a PLANS_HREF constant from a shared tenant-admin module and use in both.
- **Acceptance:**
  - Both Upgrade links land on /tenant-admin/plans.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-USAGE-04

### GAP-TENANT-ADMIN-SUBSCRIPTION-04  ·  MEDIUM  ·  partly  ·  theme WIRING (was DATEFMT)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — Download routed via /api/proxy; still latest-only link, no invoice list
- **First-pass claim:** "Download invoice" is a plain link to the "latest" invoice with no invoice list, date or amount, and goes to /api/v1 directly rather than through the proxy used by mutations (page.tsx:28).
- **Verified evidence:** Line 28 is an <a download> to /api/v1/billing/invoices/latest?format=pdf, no invoice list/date/amount. apps/web/src/app/api contains only proxy, auth, etc. (no /api/v1 route) and next.config is absent from the snapshot, so whether /api/v1 is rewritten to the gateway with auth cannot be verified. Not a date-format issue.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/subscription/page.tsx`
- **Fix steps:**
  1. Route through /api/proxy/... like mutations (confirm path) so auth headers are attached.
  2. Add an invoices list (link to /billing/invoices or loader) with date and amount using formatIndianDate/formatMoney, and link each invoice.
- **Acceptance:**
  - Download returns 200 PDF for logged-in admin, 401 handled gracefully.
  - Link labelled with invoice number/date.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-SUBSCRIPTION-05  ·  LOW  ·  confirmed  ·  theme I18N

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Quota bar has no role/aria-valuenow and encodes state only by colour; module access lists raw lowercase keys; status shows raw string with underscores replaced (page.tsx:46,54-58,71-75).
- **Verified evidence:** Quota bar (subscription/page.tsx:55-57) is <div class=bar><i style width> with no role=progressbar/aria-valuenow, colour-only thresholds. Module keys printed raw (72-73). StatusPill given label=status.replace(/_/g,' ') (46) which bypasses humanizeStatus so shows lowercase 'past due'. Amount formatting: subscription.amount (formatCurrency line 7-10) toLocaleString on a number - unit (rupees vs paise) unverified.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/subscription/page.tsx`
- **Fix steps:**
  1. Add role='progressbar' aria-valuenow/min/max and aria-label to the bar and a text '72%'.
  2. Drop custom label so StatusPill humanizes, and map module keys through a display-name map.
  3. Verify amount unit and use formatMoney if minor units.
- **Acceptance:**
  - Screen reader announces 'Users usage 72%'.
  - Status shows 'Past Due'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; amount unit is a money risk to verify.


---
## /tenant-admin/usage  —  `tenant-admin/usage.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/usage/page.tsx`
- **Design reference:** `redesign/tenant-admin/usage.html`

### GAP-TENANT-ADMIN-USAGE-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** No error branch: a failed fetch is [] so the four tiles read 0 and the card says "No usage data", i.e. an outage looks like an unused tenant; the badge is the only cue (page.tsx:6-12; UsageDisplay.tsx:36-46).
- **Verified evidence:** usage/page.tsx:6-12,23-26 has no error check; tiles read 0. UsageDisplay.tsx:39-51 shows EmptyState 'No usage data' when data is empty, with provenance badge (49) as the only difference. Other pages (siem/sso) already use RefreshErrorState.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/usage/page.tsx`, `apps/web/src/app/(app)/tenant-admin/usage/UsageDisplay.tsx`
- **Fix steps:**
  1. In page.tsx compute errored via toResourceState; tiles '—'.
  2. In UsageDisplay accept errored/provenance 'error-no-data' and render RefreshErrorState instead of EmptyState.
- **Acceptance:**
  - Force error -> retry state and dashes.
  - Genuinely empty -> 'No usage data'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-SESSIONS-01

### GAP-TENANT-ADMIN-USAGE-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Inconsistent thresholds: bar turns amber at 70 %, Upgrade appears at 80 %, warning banner and "Critical" tile at 90 %; the tile is labelled ">90%" but counts ≥ 90 (page.tsx:25-26; UsageDisplay.tsx:26-33,88).
- **Verified evidence:** Amber at 70 (UsageDisplay.tsx:19-21), Upgrade at >=80 (85), banner and tile at >=90 (page.tsx:12,26; Display:66). Tile 26 label 'Critical (>90%)' counts >=90. Tile 25 'Warning (70-90%)' counts 70<=p<90 which is consistent with >=90 critical. Copy is hardcoded, not a next-intl issue per se.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/usage/page.tsx`, `apps/web/src/app/(app)/tenant-admin/usage/UsageDisplay.tsx`
- **Fix steps:**
  1. Create shared consts WARN_PCT=70, CRIT_PCT=90 in usage/thresholds.ts.
  2. Use them in getColor, banner, tiles and Upgrade visibility; label tile 'Critical (90%+)'.
- **Acceptance:**
  - Unit test: 89 -> amber, Upgrade visible; 90 -> red, banner, counted critical.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-USAGE-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** limit of 0 (unlimited or unset) yields percent 0 and prints "n / 0", indistinguishable from unused (page.tsx:9).
- **Verified evidence:** usage/page.tsx:9 percent = limit>0 ? ... : 0; UsageDisplay.tsx:84 prints 'n / 0 unit'. UsageResource.limit is number (loaders.ts ~4541); how unlimited is encoded by the backend is not visible (0, -1 or null) - cannot verify.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/usage/page.tsx`, `apps/web/src/app/(app)/tenant-admin/usage/UsageDisplay.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm the unlimited encoding with the API owner.
  2. Make percent nullable; when no limit show 'n / Unlimited', omit the bar and exclude from tiles.
  3. Update UsageResource type accordingly.
- **Acceptance:**
  - limit 0 row shows 'Unlimited' and no 0% bar.
  - Tiles exclude it.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-USAGE-04  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Warning banner says "Upgrade or contact admin" with no link or contact; the per-row Upgrade goes to /tenant-admin/plans while Subscription upgrades via /billing/plans (UsageDisplay.tsx:65,88).
- **Verified evidence:** UsageDisplay.tsx:68 (not 65) banner text 'Upgrade or contact admin' is plain text; per-row Upgrade at 86 goes to /tenant-admin/plans (differs from subscription's /billing/plans, see SUBSCRIPTION-02). Banner is role=alert.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/usage/UsageDisplay.tsx`
- **Fix steps:**
  1. Make 'Upgrade' in the banner an <a href=/tenant-admin/plans>; remove 'contact admin' (the viewer is the admin) or link to a support route.
  2. Use shared PLANS_HREF.
- **Acceptance:**
  - Banner contains working link.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-ADMIN-SUBSCRIPTION-02

### GAP-TENANT-ADMIN-USAGE-05  ·  LOW  ·  partly  ·  theme A11Y (was LOADING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** White 11px percent label on amber/green bars has low contrast and disappears near 0 %; page lacks the Breadcrumb its siblings have and has no loading.tsx/error.tsx (UsageDisplay.tsx:96-108).
- **Verified evidence:** UsageDisplay.tsx:108-113 white 11px label inside the fill div; on #f59e0b and #10b981 contrast is roughly 2-2.5:1 (fails 4.5:1) and at ~0% the label is clipped (width 0 inside overflow:hidden parent). usage/page.tsx has no Breadcrumb (siblings do). usage/ has no loading.tsx or error.tsx, but the parent tenant-admin folder has both, so Next inherits them; only the page-specific skeleton is missing.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/usage/UsageDisplay.tsx`, `apps/web/src/app/(app)/tenant-admin/usage/page.tsx`, `apps/web/src/app/(app)/tenant-admin/usage/loading.tsx`
- **Fix steps:**
  1. Move percent text outside the bar (right of the label) with dark ink colour.
  2. Add <Breadcrumb items=[Tenant Admin, Usage & Quotas]> to page.tsx.
  3. Add usage/loading.tsx matching stat grid + card shape.
- **Acceptance:**
  - Contrast of label >=4.5:1 at 0%, 50%, 100%.
  - Breadcrumb present.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /tenant-admin/users  —  `tenant-admin/users.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/users/page.tsx`
- **Design reference:** `redesign/tenant-admin/users.html`

### GAP-TENANT-ADMIN-USERS-01  ·  HIGH  ·  confirmed  ·  theme WIRING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** The Department column is a stub that returns "—" for every row, so a directory of a department shows no department (UsersTable.tsx:104).
- **Verified evidence:** UsersTable.tsx:105 column {key:'department', render: () => '—'} returns a hardcoded dash for every row; the AdminUser type (lines 10-17) has no department field, though it's Record<string,unknown>. Header shows a column that never has data.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/users/UsersTable.tsx`
- **Fix steps:**
  1. If identity-service returns department, add department?: string|null to AdminUser and render it (with '—' fallback).
  2. Otherwise remove the Department column.
  3. Add a component test for both cases.
- **Acceptance:**
  - Row with department shows it; column absent if not supported.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; need to confirm API field (cannot verify - identity-service absent).

### GAP-TENANT-ADMIN-USERS-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch yields zero KPIs (computed from [] at page level) plus a generic empty table; only the badge inside the table signals the outage, so tiles read as a real 0 (page.tsx:8-13,34-39).
- **Verified evidence:** users/page.tsx:8-13 computes total/active/suspended/mfaEnabled from users which is [] on error (loader returns data empty, source 'error'); StatCards at 35-38 show 0. The source is passed to UsersTable (line 44), where DataSourceBadge alone signals the failure. RefreshErrorState is not used (it is used on users/[id]).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/users/page.tsx`
- **Fix steps:**
  1. In page.tsx, when source==='error' && users.length===0 pass value='—' to the four StatCards.
  2. Render RefreshErrorState (from ds, with toHumanError('load',{area:'users'})) above the table, mirroring users/[id]/page.tsx:18-25.
  3. Keep UsersTable for cached/offline seeded case (useSeededResource may still supply rows).
- **Acceptance:**
  - Mock loader error: tiles show '—', error state with retry visible.
  - Success with 0 users still shows 0.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Note UsersTable may show cached rows offline; do not hide those.

### GAP-TENANT-ADMIN-USERS-03  ·  MEDIUM  ·  partly  ·  theme WIRING (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — Success toast added; invite still collects no role
- **First-pass claim:** Invite collects no role, so every invitee lands role-less, and success just closes the dialog with no confirmation; the directory is filled by an async projection so the new row may not appear after refresh (UsersTable.tsx:117-140,189-232).
- **Verified evidence:** Invite dialog (UsersTable.tsx:155-241) collects name, email, optional empCode; body (181-189) has no role - true. On success submit() resets and onCreated closes dialog and router.refresh() (149) with no toast/confirmation - true. The dialog itself is a ConfirmDialog ('Send invite'), so confirmation before sending exists. Comment at lines 39-63 confirms directory is filled by async projection, so new row may not appear - true (documented in code). Whether the API accepts a role field is unknown.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/users/UsersTable.tsx`
- **Fix steps:**
  1. Add useToast success 'Invitation sent to <email>. It may take a moment to appear in the directory.' in onCreated.
  2. Add an optional role Select to InviteUserDialog if POST /v1/admin/users accepts roles (verify with identity-service).
  3. Optionally show optimistic 'Pending invite' row.
- **Acceptance:**
  - After invite, toast is displayed.
  - Body contains role when selected.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; role at invite is a privilege grant - requires server-side authorisation.

### GAP-TENANT-ADMIN-USERS-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Role column shows only roles[0]; multi-role users are under-reported, and the header "SSO / MFA" shows MFA only (UsersTable.tsx:105-110).
- **Verified evidence:** UsersTable.tsx:106 renders user.roles[0] only; header at 109 'SSO / MFA' but render (110-111) only shows MFA on/off; no SSO data.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/users/UsersTable.tsx`
- **Fix steps:**
  1. Render all roles (first + '+N' badge with title listing rest) via a small RoleList component.
  2. Rename header to 'MFA' unless SSO field available.
  3. Test multi-role user.
- **Acceptance:**
  - User with 3 roles shows first plus '+2'.
  - Header reads 'MFA'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-USERS-05  ·  MEDIUM  ·  partly  ·  theme CONFIRM (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No suspend/reactivate action in the list although Suspended is a filter and KPI; emails exportable with no masking (DPDP) or export audit (page.tsx:32; UsersTable.tsx:80-81).
- **Verified evidence:** No suspend/reactivate control in UsersTable columns (91-122) - true; Suspended is a filter (20) and KPI (page.tsx:37). Export is PrintExportButton (page.tsx:32), which prints the page; emails are shown unmasked in the table (UsersTable.tsx:100). No export audit call in the code read; PrintExportButton internals not inspected. Emails on an admin user directory for an admin role are normally legitimate, so 'PII' severity is arguable.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/users/page.tsx`, `apps/web/src/app/(app)/tenant-admin/users/UsersTable.tsx`, `apps/web/src/app/_components/PrintExportButton.tsx`
- **Fix steps:**
  1. Decide whether admin directory emails need masking; if so, add <Masked> with reveal+audit.
  2. Wire PrintExportButton to log an export audit event (POST via proxy) before printing.
  3. Add Suspend/Reactivate row action with ConfirmDialog+reason if the endpoint exists.
- **Acceptance:**
  - Export click emits audit request.
  - Suspend row action requires reason.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP/audit exposure; requires backend audit endpoint (cannot verify).
- **Depends on:** GAP-TENANT-ADMIN-USERS-DETAIL-03

### GAP-TENANT-ADMIN-USERS-06  ·  LOW  ·  partly  ·  theme NAV (was WIRING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — Deliberately left without page Breadcrumb per recorded decision; sibling inconsistency remains
- **First-pass claim:** Page dropped its back link and Breadcrumb (Bug A comment) while ~18 sibling pages keep both, so navigation differs within the module (page.tsx:17-27).
- **Verified evidence:** users/page.tsx:17-27 comment confirms the page-local Breadcrumb and back link were deliberately removed in favour of the global AutoBreadcrumb (convention e.g. estab/dashboard); sibling tenant-admin pages still have both, as the comment itself notes. users/[id]/page.tsx still has Breadcrumb+back. So it's a deliberate, documented inconsistency (the siblings are the outliers), not a bug on this page.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/users/[id]/page.tsx`, `apps/web/src/app/(app)/tenant-admin/Breadcrumb.tsx`
- **Fix steps:**
  1. Roll out the AutoBreadcrumb convention to the ~18 tenant-admin pages (remove local Breadcrumb and back=) in one sweep, including users/[id].
  2. No change to users/page.tsx.
- **Acceptance:**
  - Every tenant-admin page shows exactly one breadcrumb trail.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; visual navigation only.


---
## /tenant-admin/users/[id]  —  `tenant-admin/users-detail.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/users/[id]/page.tsx`
- **Design reference:** `redesign/tenant-admin/users-detail.html`

### GAP-TENANT-ADMIN-USERS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** "Reset password" and "Revoke all sessions" fire on one click with no confirmation and no audited reason, while the sessions list requires both for a single revoke (UserSecurityActions.tsx:47-62 vs sessions/SessionsTable.tsx:154-172).
- **Verified evidence:** UserSecurityActions.tsx:47-62 Reset password / Revoke all sessions call post() directly on onClick (lines 25-43), no ConfirmDialog, no reason in the POST (no body). Tenant SessionsTable.tsx:154-172 uses ConfirmDialog with danger + requireReason and passes the reason. Both actions are destructive/security-sensitive. Whether the backend records the audit event cannot be seen (identity-service absent).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/users/[id]/UserSecurityActions.tsx`
- **Fix steps:**
  1. Wrap each button in the existing ConfirmDialog (danger, requireReason, reasonLabel 'Reason (recorded in the audit log)') as done in tenant-admin/sessions/SessionsTable.tsx.
  2. Move fetch into onConfirm(reason) and send JSON body {reason} with content-type json to the reset-password and revoke-all proxy paths.
  3. State in the dialog text who receives the reset (email on file) and that revoke-all signs the user out everywhere.
  4. Keep busy/aria-busy handling; close dialog on success, show errorMessage in dialog on failure.
  5. Coordinate with identity-service so the two endpoints accept and audit `reason`.
- **Acceptance:**
  - Component test: clicking Reset password opens dialog and does not call fetch until a reason of min length is confirmed.
  - Confirmed request body contains reason.
  - Cancel makes no request.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Security-sensitive admin actions; backend must accept reason field (unverified) else request may 400.
- **Depends on:** GAP-TENANT-ADMIN-USERS-DETAIL-02

### GAP-TENANT-ADMIN-USERS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Per-row "Revoke" deletes immediately with no confirmation or reason, and on failure prints raw await res.text() from the server to the admin (SessionRevokeCell.tsx:22-30).
- **Verified evidence:** SessionRevokeCell.tsx:44-45 Revoke button calls revoke() immediately (DELETE, no body, no dialog, no reason). Lines 24-27: on !ok it throws new Error(await res.text()) and renders err.message in the role=alert span (line 49) - raw server body shown to admin. Maker!=checker is not really applicable to a single-admin revoke; the reason+audit part is valid.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/users/[id]/SessionRevokeCell.tsx`
- **Fix steps:**
  1. Add ConfirmDialog (danger, requireReason) mirroring tenant-admin/sessions/SessionsTable.tsx; send reason in the DELETE body/header.
  2. Replace throw new Error(await res.text()) with useFormError('session').fromResponse(res,'save') as UserSecurityActions does.
  3. Show the error inside the dialog via errorMessage.
  4. Extract a shared <RevokeSessionDialog> used by both this cell and SessionsTable to avoid drift.
- **Acceptance:**
  - Click Revoke: dialog appears, no DELETE until reason confirmed.
  - Mock 500 with HTML body: UI shows friendly message, not raw body.
  - Non-active row shows disabled Revoke.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Raw-body leak may expose internals; reason param needs backend support.
- **Depends on:** GAP-TENANT-ADMIN-USERS-DETAIL-01

### GAP-TENANT-ADMIN-USERS-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Roles are shown as a comma-joined raw list and cannot be assigned, suspended or MFA-reset from here; the users list promises "role assignment" but no screen does it (page.tsx:52).
- **Verified evidence:** page.tsx:52 does render roles as user.roles.join(', ') (raw tokens). No role assignment, suspend/reactivate or MFA-reset control exists on this page (only UserSecurityActions: reset password, revoke all). The users list subtitle (users/page.tsx:30) promises 'role assignment'. Whether a roles screen assigns roles was not checked beyond this page; tenant-admin/roles exists in sibling dir but no assignment UI seen in the files read.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/users/[id]/page.tsx`, `apps/web/src/app/(app)/tenant-admin/users/page.tsx`, `apps/web/src/app/(app)/tenant-admin/users/[id]/UserSecurityActions.tsx`
- **Fix steps:**
  1. Render roles as pills using a role-label map instead of join.
  2. Add Suspend/Reactivate and MFA reset actions (with ConfirmDialog+reason) only if identity-service exposes endpoints; otherwise remove 'role assignment' from users/page.tsx:30 subtitle.
  3. Add a role-assignment multi-select gated by the role guard once endpoint confirmed.
- **Acceptance:**
  - Roles show as readable pills.
  - Subtitle no longer promises unavailable features, or the feature works end-to-end.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Adding privilege-assignment UI is high-risk; needs backend endpoints and decision.

### GAP-TENANT-ADMIN-USERS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme COPY (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Profile omits department and employee code that the invite dialog collects; "Reset password" does not say where the reset goes; success/error text lives only in a transient aria-live span beside the buttons (page.tsx:47-58; UserSecurityActions.tsx:64-65).
- **Verified evidence:** page.tsx:50-56 Profile shows email, name, roles, MFA, status, last login, created - no department/employee code; the invite dialog (UsersTable.tsx:216-220) collects empCode (optional, no department). Whether UserDetail carries those fields cannot be verified (schema not in snapshot). UserSecurityActions.tsx:63-64 does put status/error in aria-live spans beside buttons only; 'Reset password' text and message 'Password reset requested.' do not say where reset goes. Also PII theme is mislabelled - email is displayed unmasked but this is admin-only.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/users/[id]/page.tsx`, `apps/web/src/app/(app)/tenant-admin/users/[id]/UserSecurityActions.tsx`
- **Fix steps:**
  1. If the API returns empCode/department, add Employee code and Department fields to Profile.
  2. Change success text to 'Password reset link sent to <email>' (pass email prop).
  3. Also surface result via useToast in addition to the aria-live span so it persists.
- **Acceptance:**
  - Profile shows employee code when present.
  - After reset, toast names the recipient email.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; confirm what reset actually does (email vs temp password) before wording.
- **Depends on:** GAP-TENANT-ADMIN-USERS-DETAIL-01

### GAP-TENANT-ADMIN-USERS-DETAIL-05  ·  LOW  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Sessions table has no device/location columns unlike the tenant sessions list; "Revoke all sessions" stays enabled when the user has none (UserSessionsTable.tsx:31-57).
- **Verified evidence:** UserSessionsTable.tsx:27-45 columns are IP address, Created, Last active, Status, Actions - no device/user-agent column, while tenant-admin/sessions/SessionsTable.tsx has deviceLabel(userAgent) (line ~22). UserSecurityActions receives only userId (page.tsx:43); Revoke-all is enabled regardless of user.sessions (empty or all non-active).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/users/[id]/UserSessionsTable.tsx`, `apps/web/src/app/(app)/tenant-admin/users/[id]/UserSecurityActions.tsx`, `apps/web/src/app/(app)/tenant-admin/users/[id]/page.tsx`
- **Fix steps:**
  1. Add Device column reusing deviceLabel from sessions/SessionsTable (move to a shared lib helper) if session has userAgent.
  2. Pass activeSessionCount={user.sessions.filter(s=>s.status==='active').length} to UserSecurityActions and disable Revoke all when 0.
  3. Note: page.tsx:62 already shows EmptyState when zero sessions, but revoke-all button remains in header.
- **Acceptance:**
  - User with zero active sessions: Revoke all disabled.
  - Device column renders label for a Chrome UA.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /tenant-admin/webhooks  —  `tenant-admin/webhooks.html`

- **Source:** `apps/web/src/app/(app)/tenant-admin/webhooks/page.tsx`
- **Design reference:** `redesign/tenant-admin/webhooks.html`

### GAP-TENANT-ADMIN-WEBHOOKS-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** When POST /api/v1/admin/webhooks fails, handleCreate still appends a locally-fabricated webhook (id Date.now()) to the list, so the user sees a webhook that was never saved; a network error is an unhandled rejection (WebhooksClient.tsx:56-79).
- **Verified evidence:** WebhooksClient.tsx:61-77 handleCreate: on !res.ok appends a fabricated WebhookSummary with id String(Date.now()) and active:true; the dialog closes at 78 regardless. The fetch .then has no .catch so a network rejection is an unhandled promise rejection (void fetch). Also list is local state initialised once from seededWebhooks (28) and never reset.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/webhooks/WebhooksClient.tsx`
- **Fix steps:**
  1. Make handleCreate async with try/catch; on !res.ok keep dialog open and show error via useFormError('webhook').fromResponse.
  2. Only append `created` on ok; then router.refresh().
  3. Remove the Date.now() branch entirely.
  4. Disable submit while busy.
- **Acceptance:**
  - Mock 500: no row added, error displayed, dialog stays open.
  - Network failure: error shown, no unhandled rejection.
  - 201: row appears.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Users currently believe an integration exists that does not - silent event loss.
- **Depends on:** GAP-TENANT-ADMIN-WEBHOOKS-02

### GAP-TENANT-ADMIN-WEBHOOKS-02  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** The "signing secret … shown once after creation" promised in the dialog is never displayed: the create response is only pushed into the list, so the secret needed to verify HMAC signatures is lost (WebhooksClient.tsx:69-71,221-224).
- **Verified evidence:** Dialog text at WebhooksClient.tsx:215 promises the secret is shown once; handleCreate (67-70) casts response to WebhookSummary (no secret field in the type, loaders.ts:4753-4761) and pushes into list; nothing renders a secret. Whether backend returns a secret in the create response cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/webhooks/WebhooksClient.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add secret?: string to a WebhookCreated type and zod-parse the create response.
  2. After success show a one-time modal with the secret, copy button, and warning; clear from state on close (never persist).
  3. If backend does not return it, change text and add a rotate-secret endpoint.
- **Acceptance:**
  - Create returns secret: modal shows it once with copy.
  - Secret absent from the list/DOM after close.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Secret handling; must not be logged or cached.
- **Depends on:** GAP-TENANT-ADMIN-WEBHOOKS-01

### GAP-TENANT-ADMIN-WEBHOOKS-03  ·  HIGH  ·  confirmed  ·  theme FAILMASK (was UUID)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** "Test" is fire-and-forget: it always shows "Test event sent to webhook {id}" for 3 s regardless of the response, and uses the raw id (WebhooksClient.tsx:40-44).
- **Verified evidence:** handleTest (34-38) does void fetch(...) without checking res, then unconditionally sets 'Test event sent to webhook {id}' for 3s using the raw id. Shown with ✅ in green role=alert (89-93).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/webhooks/WebhooksClient.tsx`
- **Fix steps:**
  1. Make handleTest async; await response, show success only on ok and error otherwise (useFormError).
  2. Display webhook URL/description instead of id.
  3. Keep result until dismissed or link to the delivery log (open it automatically).
- **Acceptance:**
  - 500 response shows error banner.
  - Success message names the URL not the id.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-WEBHOOKS-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Paused webhooks cannot be resumed and active ones cannot be paused, edited, deleted or have secrets rotated; there is no action beyond Log/Test (WebhooksClient.tsx:143-153).
- **Verified evidence:** Actions column (134-141) only has Log and Test; no pause/resume, edit, delete or rotate-secret. Status shows Active/Paused only. Endpoints for these are unknown (backend absent).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/webhooks/WebhooksClient.tsx`
- **Fix steps:**
  1. Add Pause/Resume, Edit, Delete (ConfirmDialog+reason) and Rotate secret actions if backend endpoints exist (PATCH/DELETE /api/v1/admin/webhooks/:id).
  2. Reuse ConfirmDialog; refresh via router.refresh.
  3. If endpoints missing, file backend ticket.
- **Acceptance:**
  - Pausing a webhook flips status after refresh.
  - Delete requires reason.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Mutations need audit events; deletion irreversible.

### GAP-TENANT-ADMIN-WEBHOOKS-06  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Delivery-log failures are swallowed (catch with comment) so an error shows "No deliveries yet"; attempt denominator "/3" is hard-coded (WebhooksClient.tsx:46-58,183).
- **Verified evidence:** handleViewDeliveries (40-52): if !res.ok nothing happens and catch is empty ('Silently fail'), so deliveries stays [] and the card shows 'No deliveries yet' (155-156). Also deliveries state is not cleared when switching webhook. Attempt cell hard-codes '/3' (174). Note line numbers in original were slightly off (174 not 183).
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/webhooks/WebhooksClient.tsx`
- **Fix steps:**
  1. Add deliveriesError state; on failure render RefreshErrorState/inline retry instead of EmptyState.
  2. Clear deliveries on selecting another webhook and add loading state.
  3. Use max attempts from API if provided, else render just d.attempt.
- **Acceptance:**
  - 500 on deliveries shows error, not 'No deliveries'.
  - Attempt shows API value.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-ADMIN-WEBHOOKS-07  ·  LOW  ·  confirmed  ·  theme A11Y (was CONFIRM)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1864, verified on main 9c5e9e9e9)
- **First-pass claim:** Modal is a plain div (role=dialog) with inline colours, no focus trap or Escape handling; status uses ●/○ glyphs and emoji buttons; calls bypass /api/proxy used by other admin mutations (WebhooksClient.tsx:37,192-198).
- **Verified evidence:** Modal (184-225) is a div role=dialog with className modal-overlay and inline hex styles (186); no focus trap, no Escape handler, no focus return. Status uses ●/○ (130), emoji button labels (136,139). Calls use /api/v1/admin/webhooks directly (35,43,61) whereas UsersTable uses /api/proxy/... ; no /api/v1 route in app/api and no next.config in snapshot, so how it's routed cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/tenant-admin/webhooks/WebhooksClient.tsx`
- **Fix steps:**
  1. Replace custom modal with the ds ConfirmDialog/Modal (focus trap, Escape).
  2. Use StatusPill for status; drop emoji from button text.
  3. Switch fetch URLs to /api/proxy/v1/admin/webhooks (verify proxy route) for auth header handling.
  4. Move colours to CSS tokens.
- **Acceptance:**
  - Escape closes dialog and returns focus.
  - Tab cycles inside dialog.
  - Requests go via proxy.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Changing URL to proxy may break if proxy route is not registered for webhooks.
- **Depends on:** GAP-TENANT-ADMIN-WEBHOOKS-01


---
## Backend verification items (service code absent from snapshot)

### GAP-TENANT-ADMIN-HOME-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Backends for /api/v1/admin/* are not in this snapshot (only hrms-service present) — health and readiness semantics undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/health', 'GET /api/v1/admin/health/readiness (loaders.ts:919,928)']`
- **Question:** What do health.status (ok/degraded/down) and readiness percent mean, and is readiness computed from real checks rather than static values?
- **How to verify:** Open admin-service health aggregator and readiness handler; list the checks and thresholds; stop one dependency and curl /v1/admin/health.
- **Test to add:** Given one downstream service failing, when GET /v1/admin/health, then status=degraded and that service listed with status down.
- **Impact if wrong:** False green health hides outages from tenant admins.
- **Web change if wrong:** Extend mapAggregateHealth to any additional status values returned; otherwise none.

### GAP-TENANT-ADMIN-ACTIVATION-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** analytics-service is not in this snapshot — endpoint contracts undeterminable.
- **Service:** `analytics-service`  ·  **Endpoint(s):** `['GET /api/v1/analytics/activation/funnel', 'GET /api/v1/analytics/activation/funnel/platform']`
- **Question:** Do both funnel endpoints exist, is /platform restricted to platform admins, and are responses tenant-scoped?
- **How to verify:** Open analytics-service funnel routes; call /platform with a tenant admin token expecting 403; compare shape with web schema.
- **Test to add:** Given tenant admin; when GET funnel/platform; then 403; GET funnel returns only own tenant stages.
- **Impact if wrong:** Cross-tenant metrics leak.
- **Web change if wrong:** Adjust mapper to real stage shape if different.

### GAP-TENANT-ADMIN-API-KEYS-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Read path is /api/v1/admin/api-keys while writes go to /api/proxy/identity/api-keys — two services/contracts for one resource; neither backend is in this snapshot, so mismatch is undeterminable (loaders.ts:4316, APIKeyActions.tsx:71,98).
- **Service:** `identity-service (and admin-service)`  ·  **Endpoint(s):** `['GET /api/v1/admin/api-keys', 'POST/DELETE /api/proxy/identity/api-keys']`
- **Question:** Do the read (admin) and write (identity) paths operate on the same api-keys store so a created key appears in the list?
- **How to verify:** Check gateway routing for /api/v1/admin/api-keys vs identity/api-keys; create a key via POST then list; open both services' handlers.
- **Test to add:** Given POST api-key; when GET /api/v1/admin/api-keys; then the new key (prefix only, no secret) is listed; revoke removes it.
- **Impact if wrong:** Created/revoked keys not reflected; stale keys stay live.
- **Web change if wrong:** Point loaders.ts:4316 and APIKeyActions.tsx:71,98 to a single path.

### GAP-TENANT-ADMIN-AUDIT-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Audit service backend is not in this snapshot; pagination/limit of /api/v1/audit/events undeterminable.
- **Service:** `audit-service`  ·  **Endpoint(s):** `['GET /api/v1/audit/events?tenantScoped=true']`
- **Question:** Does the events endpoint paginate with a bounded limit and a cursor/offset and return total/hasMore?
- **How to verify:** Open audit-service events handler; check zod limit max and cursor; GET limit=100000 and with offset.
- **Test to add:** Given 500 events; when GET limit=50; then 50 rows plus next cursor; limit>max returns 400 or clamps.
- **Impact if wrong:** Truncated audit view or heavy unbounded queries.
- **Web change if wrong:** Add pagination controls to tenant-admin audit page if server paginates.

### GAP-TENANT-ADMIN-BREAKGLASS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** identity-service / admin-service backends are not in this snapshot; auto_expired semantics undeterminable.
- **Service:** `identity-service (and admin-service)`  ·  **Endpoint(s):** `['GET /api/v1/admin/breakglass', 'POST /api/proxy/identity/break-glass/{id}/close']`
- **Question:** What does status auto_expired mean, when is it set (TTL job), and is it distinct from closed?
- **How to verify:** Open break-glass session model and expiry job in identity-service; create a session with short TTL and GET after expiry.
- **Test to add:** Given session with 1 minute TTL; when TTL elapses; then status===auto_expired with expiredAt and audit event; manual close yields closed.
- **Impact if wrong:** Misleading incident reporting on privileged access.
- **Web change if wrong:** Add auto_expired to status filter/pill in BreakglassTable.tsx if missing.

### GAP-TENANT-ADMIN-COMPLIANCE-02  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Scores are opaque percentages with no method, scope or as-of date, and the check list has no link to evidence; a DPDP score shown to the board needs provenance (page.tsx:37-40). Backend absent — undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/compliance (loaders.ts getComplianceOverview ~L4743)']`
- **Question:** Does each compliance score in the response carry method, scope and asOf (computed-at) fields plus per-check evidence reference?
- **How to verify:** Open admin-service compliance route/handler and its zod response schema; curl GET /v1/admin/compliance as tenant_admin and inspect for score, method, scope, asOf, checks[].evidenceUrl.
- **Test to add:** Given a tenant with DPDP checks, when GET /v1/admin/compliance, then each score has method, scope, asOf (UTC ISO) and every check has evidenceRef or explicit null.
- **Impact if wrong:** Board-level DPDP score without provenance is not defensible in audit; misreported compliance.
- **Web change if wrong:** If fields absent, backend to add them; web then renders method/scope/as-of and evidence links in tenant-admin/page compliance view; otherwise none.

### GAP-TENANT-ADMIN-COMPLIANCE-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** admin-service /api/v1/admin/compliance is not in this snapshot.
- **Service:** `admin-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/compliance']`
- **Question:** Does admin-service expose GET /v1/admin/compliance, restricted to tenant_admin/platform_admin, returning the shape web's getComplianceOverview maps?
- **How to verify:** In admin-service open the compliance route file; check preHandler role guard and response schema; curl with tenant_admin (200) and a plain user token (403).
- **Test to add:** Given a non-admin token, when GET /v1/admin/compliance, then 403; given tenant_admin, then 200 with tenantId-scoped scores only.
- **Impact if wrong:** Missing route means page always empty; missing role guard leaks compliance posture.
- **Web change if wrong:** none if route matches; else align mapResponse in loaders.ts getComplianceOverview.

### GAP-TENANT-ADMIN-DATA-EXPORT-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** admin-service export pipeline is not in this snapshot; the 48-hour expiry is undeterminable server-side.
- **Service:** `admin-service`  ·  **Endpoint(s):** `['GET/POST /api/v1/admin/data-exports (DataExportClient.tsx:49 POST returns 202)']`
- **Question:** Do completed data exports expire and become undownloadable exactly 48 hours after completion, with expiresAt returned in the API?
- **How to verify:** Open the export job worker and download route in admin-service; check storage lifecycle/TTL and expiresAt column; create an export, advance clock 48h+1m, request download.
- **Test to add:** Given an export completed at T, when download is requested at T+48h01m, then 410 Gone and the object is deleted; at T+47h it returns 200.
- **Impact if wrong:** Personal-data export links remaining live beyond stated expiry is a DPDP exposure.
- **Web change if wrong:** Render expiresAt from the API instead of a hard-coded 48-hour string if they differ.

### GAP-TENANT-ADMIN-DOMAIN-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1864 — DomainClient now uses /api/proxy/v1/admin/custom-domains; backend authz/tenant scoping unverified
- **First-pass claim:** Writes go to /api/v1/admin/... directly while other tenant-admin writes use /api/proxy/...; auth handling difference undeterminable (backend absent).
- **Service:** `admin-service`  ·  **Endpoint(s):** `['POST /api/v1/admin/custom-domains', 'POST /api/v1/admin/custom-domains/:id/verify', 'DELETE /api/v1/admin/custom-domains/:id (DomainClient.tsx:40,65,70, direct fetch, credentials same-origin)']`
- **Question:** Do the direct /api/v1/admin/* calls authenticate via the session cookie/CSRF at the gateway exactly like /api/proxy/* writes, with tenant scoping and role check?
- **How to verify:** Compare the Next route handling /api/v1/admin/* with /api/proxy/[...path] (auth header injection, CSRF/device binding); in admin-service check custom-domains routes require tenant_admin; call without cookie expecting 401 and cross-tenant id expecting 404.
- **Test to add:** Given a request lacking session/CSRF, when POST /api/v1/admin/custom-domains, then 401/403; given tenant A admin deleting tenant B domain id, then 404.
- **Impact if wrong:** Unauthenticated or cross-tenant domain hijack (tenant takeover) if direct path bypasses proxy controls.
- **Web change if wrong:** Switch DomainClient.tsx and WebhooksClient.tsx fetches to /api/proxy/v1/admin/... to match other writes.

### GAP-TENANT-ADMIN-IDP-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Identity backend is not in this snapshot; status vocabulary beyond 'active' undeterminable.
- **Service:** `identity-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/idp/providers (loaders.ts ~L4701)']`
- **Question:** What is the complete enum of IdP provider status values returned (beyond 'active')?
- **How to verify:** Open identity/admin-service idp provider schema/enum; curl the endpoint with providers in each state.
- **Test to add:** Given providers in states created, testing, active, failed, disabled, when listed, then status is one of the documented enum and web maps each to a pill.
- **Impact if wrong:** Unknown status renders wrongly (e.g. failed IdP shown as healthy).
- **Web change if wrong:** Add pill mapping for every enum value in idp page/table; default to neutral not success.

### GAP-TENANT-ADMIN-INSTALL-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** install-service is not in this snapshot; /api/v1/install/steps vs /install/stages (installer) relationship undeterminable.
- **Service:** `install-service`  ·  **Endpoint(s):** `['GET /api/v1/install/steps (loaders.ts:4344)', 'GET /api/v1/install/stages (loaders.ts:748)']`
- **Question:** Are install steps and installer stages the same resource at two granularities, and is step status consistent with the stage rollup?
- **How to verify:** Open install-service routes for steps and stages; compare schemas and derive step->stage mapping; curl both for one tenant.
- **Test to add:** Given a tenant with 2 of 5 stages complete, when both endpoints are read, then steps completed count equals sum of steps of completed stages.
- **Impact if wrong:** Onboarding shows contradictory progress between pages.
- **Web change if wrong:** Point both pages to one endpoint or add stage grouping to the steps page.

### GAP-TENANT-ADMIN-MFA-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Identity/admin backend not in this snapshot; the set of mfaStatus values is undeterminable.
- **Service:** `identity-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/mfa/users (loaders.ts ~L4683)']`
- **Question:** What is the full enum of mfaStatus (e.g. enrolled, pending, disabled, exempt) returned?
- **How to verify:** Open identity-service MFA status enum / DTO; query users in each state.
- **Test to add:** Given users with each MFA state, when GET /v1/admin/mfa/users, then mfaStatus is within the documented enum.
- **Impact if wrong:** Users without MFA shown as compliant.
- **Web change if wrong:** Update the status-to-pill map in the mfa page for all enum values.

### GAP-TENANT-ADMIN-NOTIFICATIONS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** notification-service is not in this snapshot; per-row PATCH contract undeterminable.
- **Service:** `notification-service`  ·  **Endpoint(s):** `['GET /api/notification/preferences (loaders.ts:4335)', 'PATCH /api/proxy/notification/prefs/:id (NotificationPrefActions.tsx:82)']`
- **Question:** Does PATCH /prefs/:id accept the body web sends (enabled flag), validate with zod, enforce tenant/user ownership and emit an audit event?
- **How to verify:** Open notification-service prefs route; compare zod body with NotificationPrefActions payload; PATCH another tenant's id expecting 404.
- **Test to add:** Given pref id of tenant B, when tenant A admin PATCHes it, then 404 and no change; valid patch returns updated row and emits audit event.
- **Impact if wrong:** Cross-tenant preference tampering; silent notification suppression.
- **Web change if wrong:** Align payload/URL (also note list path /preferences vs patch path /prefs) if mismatched.

### GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** notification-service not in this snapshot; status values undeterminable.
- **Service:** `notification-service`  ·  **Endpoint(s):** `['GET /api/notification/channels (channels/page.tsx:21)']`
- **Question:** What are the possible channel status values (active, degraded, disabled, unconfigured)?
- **How to verify:** Open notification-service channels DTO/enum; list channels with a failing provider.
- **Test to add:** Given an SMS channel with invalid credentials, when listed, then status=error/degraded not active.
- **Impact if wrong:** Broken delivery channel appears healthy.
- **Web change if wrong:** Map every enum value to a distinct pill in the channels page.

### GAP-TENANT-ADMIN-OPERATIONS-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Log excerpts are shown to platform admins in a 'redacted' column, but redaction is claimed 'server-side' with no client safeguard and the backend is not in this snapshot — undeterminable; DPDP risk if PII leaks in error lines (OperationsTables.tsx:72-80).
- **Service:** `admin-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/operations (loaders.ts:4292)']`
- **Question:** Is log excerpt redaction (emails, phones, Aadhaar, PAN, tokens) applied in admin-service before the response, and is the endpoint limited to platform_admin/super_admin?
- **How to verify:** Open admin-service operations handler and redaction util; seed a log line with email/Aadhaar/JWT and curl as platform_admin and tenant_admin (expect 403).
- **Test to add:** Given an error log containing 'user a@b.in aadhaar 1234 5678 9012 token eyJ...', when GET /v1/admin/operations, then excerpt contains masked values only.
- **Impact if wrong:** PII/secret leakage to admin browsers: DPDP breach, CERT-In reportable.
- **Web change if wrong:** Add client-side defensive mask in OperationsTables.tsx:72-80 and hide column for non-platform roles if server redaction absent.

### GAP-TENANT-ADMIN-OPERATIONS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** admin-service /api/v1/admin/operations not in this snapshot; PM2 dependence (hosting assumption) undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/operations']`
- **Question:** Is the PM2 fleet snapshot a deployment-agnostic abstraction, or does it fail (with a clear status) on hosts/containers without PM2?
- **How to verify:** Open admin-service operations collector; run it in a container without pm2 and curl.
- **Test to add:** Given no PM2 daemon, when GET /v1/admin/operations, then 200 with processes=[] and mode='unavailable' rather than 500.
- **Impact if wrong:** Operations page unusable on Kubernetes/ECS deployments.
- **Web change if wrong:** Show 'not applicable on this host' state from mode field; otherwise none.

### GAP-TENANT-ADMIN-ORG-HIERARCHY-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** admin-service /api/v1/admin/org-hierarchy not in this snapshot; whether headCount is direct or rolled-up is undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/org-hierarchy (loaders.ts:4666)']`
- **Question:** Is headCount direct reports/employees of the node only, or rolled up including descendants?
- **How to verify:** Open admin-service org-hierarchy query; check whether count aggregates via recursive CTE; compare parent with sum of children.
- **Test to add:** Given parent with 2 children of 5 employees each and 1 direct, when read, then headCount is documented (1 direct or 11 rolled-up) and consistent.
- **Impact if wrong:** Misleading headcount reporting and budgeting.
- **Web change if wrong:** Label the column 'Direct' or 'Total' per contract, and avoid summing rolled-up values in the UI.

### GAP-TENANT-ADMIN-ORG-TYPE-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Tenant service (PATCH /v1/tenants/:id) is not in this snapshot; whether orgType is validated or audited is undeterminable.
- **Service:** `tenant-service`  ·  **Endpoint(s):** `['PATCH /v1/tenants/:id with {settings:{orgType}} (org-type/page.tsx:55)']`
- **Question:** Does PATCH /v1/tenants/:id validate orgType against a fixed enum, restrict to tenant_admin, and emit an audit event with old/new value?
- **How to verify:** Open tenant-service tenants route and zod schema; PATCH orgType='bogus' expecting 422; check audit emission.
- **Test to add:** Given orgType='bogus', when PATCH, then 422; given valid change, then 200 and audit event orgType.changed with before/after.
- **Impact if wrong:** Edition/entitlement misconfiguration without an audit trail.
- **Web change if wrong:** none unless enum differs; then update option list on the org-type page.

### GAP-TENANT-ADMIN-PLANS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Money handled as paise then formatCurrency(paise/100).toLocaleString('en-IN') — correct lakh grouping but floating division and duplicated in page.tsx and PlansClient.tsx; billing-service is not in this snapshot (undeterminable).
- **Service:** `billing-service`  ·  **Endpoint(s):** `['GET /api/v1/billing/plans (loaders.ts getPlansData ~L4600)']`
- **Question:** Are plan prices and invoice amounts returned as integer paise (bigint minor units) with an ISO currency code?
- **How to verify:** Open billing-service plans DTO and Drizzle schema; curl and check priceMinor is integer with currency field.
- **Test to add:** Given a plan of INR 1,499.50, when listed, then price=149950 (paise) and currency='INR'.
- **Impact if wrong:** Amounts shown 100x wrong or rounding errors on billing pages.
- **Web change if wrong:** Replace paise/100 float division with shared lib/money.ts helper in page.tsx and PlansClient.tsx (single implementation).

### GAP-TENANT-ADMIN-PLATFORM-CONFIG-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Infrastructure card prints Redis URL, DB host, queue and bucket endpoints verbatim to the browser; a Redis URL can embed credentials (page.tsx:124,150,160,196). Backend (admin-service) is absent from this snapshot so redaction is undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/platform-config (page.tsx:25)']`
- **Question:** Does admin-service strip credentials from redisUrl/dbHost/queue/bucket endpoints (userinfo, passwords, access keys) and limit the endpoint to platform_admin/super_admin?
- **How to verify:** Open platform-config handler; set REDIS_URL=redis://:secret@host:6379 and curl as platform_admin and tenant_admin (expect 403).
- **Test to add:** Given redis URL with password, when GET, then response contains host:port only, no userinfo; tenant_admin gets 403.
- **Impact if wrong:** Credential disclosure to browser and logs; infrastructure compromise.
- **Web change if wrong:** Until confirmed, render host:port only via a URL-sanitising helper in platform-config/page.tsx:124,150,160,196 and gate page to platform roles.

### GAP-TENANT-ADMIN-READINESS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Dashboard endpoint and readiness computation live in an admin backend not present in this snapshot; scoring rules are undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/health/readiness (loaders.ts:928)']`
- **Question:** How is the readiness percentage computed (checks, weights, pass criteria) and is it derived from live state?
- **How to verify:** Open the readiness computation in admin-service; list checks and weights; toggle one setting and re-curl.
- **Test to add:** Given 3 of 4 equally weighted checks passing, when GET readiness, then score=75 and failed check listed.
- **Impact if wrong:** Tenants go live believing they are ready when they are not.
- **Web change if wrong:** Show failing checks list if provided; otherwise none.

### GAP-TENANT-ADMIN-ROLES-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Policy service (/api/policy/roles, /api/proxy/policy/roles) is not in this snapshot; role name uniqueness and permission on create are undeterminable.
- **Service:** `policy-service`  ·  **Endpoint(s):** `['POST /api/proxy/policy/roles (RolesTable.tsx:121)', 'GET /api/policy/roles']`
- **Question:** Does POST /roles enforce unique name per tenant (409), create with zero permissions by default, and emit an audit event?
- **How to verify:** Open policy-service roles route and DB unique index (tenantId,name); POST same name twice.
- **Test to add:** Given role 'Auditor' exists, when POST name 'auditor', then 409 and no row; new role has no permissions and audit role.created is emitted.
- **Impact if wrong:** Duplicate roles cause ambiguous access grants; new roles accidentally over-privileged.
- **Web change if wrong:** Handle 409 with inline name error in RolesTable.tsx; otherwise none.

### GAP-TENANT-ADMIN-ROLES-DETAIL-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Cell keys are "module:action" and split on ":" so a module or resource containing a colon breaks the mapping; the optional resource field of Perm is ignored (PermissionGrid.tsx:15-17,97-98). Policy backend absent; role/permission semantics undeterminable.
- **Service:** `policy-service`  ·  **Endpoint(s):** `['GET /api/policy/roles/:id', 'POST /api/proxy/policy/roles/:id/permissions (PermissionGrid.tsx:91)']`
- **Question:** Can a permission's module/action contain ':' and does Perm carry a resource field that must be part of the grant key?
- **How to verify:** Open policy-service permission schema/seed; grep for ':' in module/action names; check whether resource is used in authorization decisions.
- **Test to add:** Given permission {module:'a:b',action:'read',resource:'x'}, when grid saves, then server stores exact module, action, resource unchanged.
- **Impact if wrong:** Wrong permissions granted/dropped when keys split incorrectly: privilege escalation or lockout.
- **Web change if wrong:** Key cells by JSON tuple or index and include resource in PermissionGrid.tsx:15-17,97-98.

### GAP-TENANT-ADMIN-SECURITY-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Outcome maps every value other than success/flagged to a red pill, so a "pending" or "challenged" event reads as a failure; the set of outcome values is undeterminable (backend absent) (SecurityTable.tsx:24).
- **Service:** `admin-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/security/overview (loaders.ts:4629)']`
- **Question:** What is the complete enum of security event outcome values?
- **How to verify:** Open admin-service security event schema/enum; query events of each outcome.
- **Test to add:** Given events with outcome success, failure, flagged, pending, challenged, when listed, then each value is in the documented enum.
- **Impact if wrong:** Pending/challenged events shown as failures, misleading incident triage.
- **Web change if wrong:** Map outcomes explicitly in SecurityTable.tsx:24 (neutral/warn pill for pending, challenged; red only for failure/denied).

### GAP-TENANT-ADMIN-SESSIONS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Identity service is not in this snapshot; whether DELETE is tenant-scoped and audited server-side is undeterminable.
- **Service:** `identity-service`  ·  **Endpoint(s):** `['GET /api/identity/sessions', 'DELETE /api/proxy/identity/sessions/:id (SessionsTable.tsx:57)']`
- **Question:** Does DELETE /sessions/:id only revoke sessions in the caller's tenant (404 otherwise) and emit an audit event?
- **How to verify:** Open identity-service sessions route; DELETE a tenant B session id as tenant A admin.
- **Test to add:** Given session of tenant B, when tenant A admin DELETEs, then 404 and session remains; own-tenant delete gives 204 with session.revoked audit.
- **Impact if wrong:** Cross-tenant session kill (DoS) or unaudited revocation.
- **Web change if wrong:** none

### GAP-TENANT-ADMIN-SETTINGS-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** admin-service toggle endpoint and audit emission are claimed in a code comment but the service is absent from this snapshot (ModuleToggleActions.tsx:16-18).
- **Service:** `admin-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/admin/tenant/modules/:key/toggle (ModuleToggleActions.tsx:53)']`
- **Question:** Does the toggle endpoint require tenant_admin, validate key against known modules, enforce approval/maker-checker when required, and emit an audit event?
- **How to verify:** Open admin-service tenant modules toggle route; check audit emit call and comment claim at ModuleToggleActions.tsx:16-18.
- **Test to add:** Given unknown module key, when toggle, then 404/422; valid toggle emits module.toggled audit with actor, before, after.
- **Impact if wrong:** Untracked entitlement changes; compliance audit gap.
- **Web change if wrong:** none if audit is emitted; else none in web (backend fix).

### GAP-TENANT-ADMIN-SIEM-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** SIEM ingestion/alerting service is not in this snapshot; alert lifecycle is undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/siem/alerts (loaders.ts:4567)']`
- **Question:** What are the alert lifecycle states (open, acknowledged, resolved, suppressed) and is there an endpoint to transition them?
- **How to verify:** Open admin-service or siem module alert schema/enum and transitions; curl list with mixed states.
- **Test to add:** Given an alert in each state, when listed, then state within enum and transition endpoint rejects illegal moves.
- **Impact if wrong:** Alerts mishandled or hidden from responders.
- **Web change if wrong:** Add state pills/filters for all lifecycle states.

### GAP-TENANT-ADMIN-SSO-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Identity backend not in this snapshot; provider secrets handling and status values are undeterminable.
- **Service:** `identity-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/sso/providers (loaders.ts:4532)']`
- **Question:** Does the response omit provider secrets (clientSecret, signing keys) and what status values exist?
- **How to verify:** Open identity-service SSO provider serializer; curl as tenant_admin and grep response for secret.
- **Test to add:** Given provider with clientSecret set, when listed, then response has hasSecret:true and no secret value.
- **Impact if wrong:** SSO client secret exposure in browser.
- **Web change if wrong:** Strip/never render secret-like fields; map all status values to pills.

### GAP-TENANT-ADMIN-SUBSCRIPTION-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Amount is formatted as ₹ + toLocaleString with no paise conversion; product rules say money is paise bigint, so the unit returned by billing is undeterminable and may display 100x too high (page.tsx:7-10).
- **Service:** `billing-service`  ·  **Endpoint(s):** `['GET /api/v1/billing/subscriptions (loaders.ts:4308)']`
- **Question:** Is subscription amount returned in paise (minor units) or rupees?
- **How to verify:** Open billing-service subscription DTO/Drizzle schema (bigint minor units per CLAUDE.md rule 11); curl and compare with plan price.
- **Test to add:** Given plan INR 4,999/month, when GET subscription, then amount=499900 and currency='INR'.
- **Impact if wrong:** Displayed amount 100x too high on customer billing page.
- **Web change if wrong:** Divide by 100 via lib/money.ts formatter in subscription/page.tsx:7-10 (or format from minor units).

### GAP-TENANT-ADMIN-SUBSCRIPTION-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Billing backend is not in this snapshot; subscription status values and limits semantics are undeterminable.
- **Service:** `billing-service`  ·  **Endpoint(s):** `['GET /api/v1/billing/subscriptions', 'GET /api/v1/billing/invoices/latest?format=pdf']`
- **Question:** What are the subscription status values (trialing, active, past_due, cancelled) and what do limit fields mean (hard cap vs soft, unit)?
- **How to verify:** Open billing-service subscription enum and limits schema; curl subscriptions in each state.
- **Test to add:** Given past_due subscription, when read, then status='past_due' and web shows warning not active.
- **Impact if wrong:** Wrong entitlement/billing status shown to customer.
- **Web change if wrong:** Map all status values to pills; label limits with unit.

### GAP-TENANT-ADMIN-USAGE-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Usage service not in this snapshot; the resource list and projection model are undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/usage (loaders.ts:4550)']`
- **Question:** Which resources does the usage endpoint return, and is the projection (forecast/exhaustion date) computed server-side with a documented model?
- **How to verify:** Open admin-service usage handler; list resource keys, unit, limit, projection formula.
- **Test to add:** Given usage 80/100 growing 10/day, when read, then projected exhaustion in 2 days per documented model.
- **Impact if wrong:** Quota overrun surprises; misleading forecasts.
- **Web change if wrong:** Render unit and projection basis from API; none if already provided.

### GAP-TENANT-ADMIN-USERS-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Identity service not in this snapshot; invitation email, role default and audit are undeterminable.
- **Service:** `identity-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/admin/users (UsersTable.tsx:181)', 'GET /api/identity/users']`
- **Question:** Does creating/inviting a user send an invitation email, apply a least-privilege default role, and emit an audit event?
- **How to verify:** Open identity-service/gateway /v1/admin/users alias handler; create user without role and check role assignment, mail outbox and audit.
- **Test to add:** Given invite with no role, when POST, then user has default least-privilege role, invitation queued, audit user.invited emitted; duplicate email gives 409.
- **Impact if wrong:** Over-privileged new accounts or unaudited user creation.
- **Web change if wrong:** Show default role and invitation state in UI; handle 409.

### GAP-TENANT-ADMIN-USERS-DETAIL-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Identity service not in this snapshot; whether reset-password is audited and rate-limited is undeterminable.
- **Service:** `identity-service`  ·  **Endpoint(s):** `['POST /api/proxy/identity/users/:id/reset-password', 'POST /api/proxy/identity/users/:id/sessions/revoke-all (UserSecurityActions.tsx:51,59)']`
- **Question:** Is reset-password tenant-scoped, role-restricted, audited and rate-limited per target user and per actor?
- **How to verify:** Open identity-service users routes; fire 6 resets in 1 min for one user; try user of another tenant.
- **Test to add:** Given 6 reset requests in 60s for one user, when the last is sent, then 429; every accepted request emits user.password_reset_requested audit; cross-tenant id returns 404.
- **Impact if wrong:** Account takeover/mail-bombing via admin action; missing audit trail.
- **Web change if wrong:** Show 429 message in UserSecurityActions; otherwise none.

### GAP-TENANT-ADMIN-WEBHOOKS-05  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Create accepts any type=url (including http or private hosts) and zero events; the event list is a hard-coded 12-event constant, not from the backend; server-side SSRF validation is undeterminable (WebhooksClient.tsx:10-15,200-215).
- **Service:** `admin-service`  ·  **Endpoint(s):** `['POST /api/v1/admin/webhooks (WebhooksClient.tsx:61)', 'GET /api/v1/admin/webhooks', 'POST /api/v1/admin/webhooks/:id/test']`
- **Question:** Does the server reject non-https, private/loopback/link-local/metadata (SSRF) targets, empty events, and unknown event names, and re-check the resolved IP at delivery time?
- **How to verify:** Open admin-service webhooks create schema and delivery worker; POST url=http://169.254.169.254/, http://localhost, https://10.0.0.5 and events=[].
- **Test to add:** Given url http://169.254.169.254/latest, when POST webhook or test, then 422 and no outbound request; events=[] gives 422; event names validated against server registry.
- **Impact if wrong:** SSRF into internal network/cloud metadata from tenant-controlled URL.
- **Web change if wrong:** Fetch event list from backend instead of 12-event constant; require https and >=1 event client-side (WebhooksClient.tsx:10-15,200-215).


---
## Cannot verify from the snapshot

### GAP-TENANT-ADMIN-ORG-HIERARCHY-02 · /tenant-admin/org-hierarchy
- **First-pass claim:** Total Staff sums headCount at every level; if the API returns rolled-up counts per node the parents are double-counted — the contract is unspecified (page.tsx:8-15).
- **Why cannot-verify:** org-hierarchy/page.tsx:8-15 countAll adds node.headCount at every level then recurses. OrgHierarchyNode.headCount (loaders.ts:4658) has no documented semantics and the endpoint /api/v1/admin/org-hierarchy is served by admin-service, which is not in the snapshot, so it cannot be confirmed whether headCount is direct or rolled-up. Recommendation: confirm contract with admin-service; if rolled-up use root headCount only.
