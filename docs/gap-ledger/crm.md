# Detailed gap file — module `crm`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 343, BACKEND-VERIFY 16, CANNOT-VERIFY 1



---
## /crm  —  `crm/home.html`

- **Source:** `apps/web/src/app/(app)/crm/page.tsx`
- **Design reference:** `redesign/crm/home.html`

### GAP-CRM-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** All 35 tiles render for every CRM role, but ten routes (Custom Fields, Matching Rules, Lead Scoring, Qualification Frameworks, Lead Stage Reasons, Assignment Rules, Assignment Directory, Escalation Rules, Task Escalation, Document Types) sit behind requireAnyRole(crm_admin, admin, super_admin, platform_admin, tenant_admin) and silently redirect a crm_user back to /crm, so the tile looks broken; Agent Workload, also labelled admin in its own source comment, has no gate at all (app/(app)/crm/page.tsx:53, app/(app)/crm/custom-fields/layout.tsx:8, app/(app)/crm/assignment-rules/layout.tsx:11).
- **Verified evidence:** page.tsx:53-62 lists all 35 tiles unfiltered; ten route layouts call requireAnyRole(['crm_admin','admin','super_admin','platform_admin','tenant_admin'],'/crm') (custom-fields, lead-scoring, qualification-frameworks, lead-reason-codes, assignment-rules, assignment-directory, escalation-rules, task-escalation, document-types) and dedup-rules redirects to /crm/data-quality (not /crm). CRM layout allows crm_user (layout.tsx:5) so a crm_user is bounced. agent-workload has no layout; page.tsx:4 comment says 'admin'. Server enforcement in crm-service is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/crm/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`, `apps/web/src/app/(app)/crm/agent-workload/layout.tsx (new)`, `apps/web/src/app/_components/LinkTiles.tsx`
- **Fix steps:**
  1. Export CRM_ADMIN_ROLES from lib/auth/roleGuard (or lib/crm/roles.ts) and replace the ten duplicated ALLOWED_ROLES arrays.
  2. In page.tsx call getSessionRoles(); mark Configuration admin tiles adminOnly and filter them (or render disabled with tooltip) for non-admins.
  3. Add agent-workload/layout.tsx with requireAnyRole(CRM_ADMIN_ROLES,'/crm') if it is truly admin-only (decision).
  4. Confirm crm-service also rejects non-admin PUTs.
- **Acceptance:**
  - crm_user session: Configuration section shows only permitted tiles.
  - crm_admin sees all 12.
  - crm_user hitting /crm/agent-workload redirects (if gated).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Access control; hiding is UX only, server must enforce.

### GAP-CRM-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Vocabulary conflicts with the rest of the module: hub says "Deals", "Sales Pipelines", "Quotations" while the Deals page is titled "Vendor / Stakeholder Engagements" and the dashboard notes the module is "not a commercial sales pipeline" (app/(app)/crm/page.tsx:21).
- **Verified evidence:** page.tsx:13 'Deals', :18 'Sales & Pipeline', :21 'Sales Pipelines', :25 'Quotations' vs deals/page.tsx:16 title 'Vendor / Stakeholder Engagements' and crm/dashboard/page.tsx:44-47 'not a commercial sales pipeline'. Tile description at :13 already says 'Engagements'.
- **Files to change:** `apps/web/src/app/(app)/crm/page.tsx`, `apps/web/src/app/(app)/crm/deals/page.tsx`, `apps/web/messages/en.json`
- **Fix steps:**
  1. Product decision on vocabulary (Engagements/Procurement vs Sales).
  2. Rename tiles: Deals->Engagements, Sales Pipelines->Engagement Pipelines, section 'Engagement Pipeline'; check Quotations/Price Books for consistency.
  3. Keep hrefs unchanged; update nav manifest (navRouteManifest.ts) labels to match.
- **Acceptance:**
  - Hub tile titles equal the destination page titles (test comparing).
  - No 'Sales' wording remains in hub.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-HOME-03  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle is hard-coded English while the title goes through next-intl, so the page is half-translated in any other locale (app/(app)/crm/page.tsx:75).
- **Verified evidence:** page.tsx:75 subtitle 'Pipeline and customer operations workspace.' is a literal while title uses t('title') (:74). Worse than stated: section headings and every tile title/description (:6-66) are also English literals, and messages/en.json crm.title is 'Citizen Services' (line 1149), which does not match the CRM module name used elsewhere.
- **Files to change:** `apps/web/src/app/(app)/crm/page.tsx`, `apps/web/messages/en.json`, `apps/web/messages/hi.json`
- **Fix steps:**
  1. Add crm.subtitle, crm.sections.*, crm.tiles.* keys to en.json and hi.json.
  2. Build sections inside the component using t(); keep hrefs static.
  3. Review crm.title value ('Citizen Services') vs module naming.
- **Acceptance:**
  - hi locale: header, section headings and tiles translated.
  - Key parity check passes between en and hi.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-HOME-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx shows 4 stat tiles and a 288px block wrapped in min-h-screen bg-slate-50, unlike the loaded hub (tile sections) and nested inside the app shell padding (app/(app)/crm/loading.tsx:3).
- **Verified evidence:** crm/loading.tsx:3 wraps in min-h-screen bg-slate-50 p-6 md:p-8 with 4 stat tiles (h-24) and h-72 block; loaded hub (page.tsx:77-89) is a PageHeader plus five tile sections. Same wrapper pattern in health/loading.tsx:3, so it is systemic.
- **Files to change:** `apps/web/src/app/(app)/crm/loading.tsx`
- **Fix steps:**
  1. Replace wrapper with a shared <TileHubSkeleton sections={5}> (new in _components/ds/Skeleton) rendering header bar + section labels + grid of tile placeholders.
  2. Drop min-h-screen/bg-slate-50 so it inherits the app shell.
- **Acceptance:**
  - Loading state visually matches hub layout (no stat row).
  - No double padding inside shell.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-HOME-05  ·  LOW  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** not-found EmptyState has no link back to the CRM hub (app/(app)/crm/not-found.tsx:1).
- **Verified evidence:** crm/not-found.tsx renders <EmptyState title message/> with no action prop (EmptyState supports action, ds/EmptyState.tsx:8). Note it is a segment not-found, shown only where notFound() is called under /crm.
- **Files to change:** `apps/web/src/app/(app)/crm/not-found.tsx`
- **Fix steps:**
  1. Pass action={<a className='btn' href='/crm'>Back to CRM</a>} (or ds Button link).
  2. Use the same for other module not-found files via a shared ModuleNotFound.
- **Acceptance:**
  - Not-found page shows a working link to /crm.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /crm/accounts  —  `crm/accounts.html`

- **Source:** `apps/web/src/app/(app)/crm/accounts/page.tsx`
- **Design reference:** `redesign/crm/accounts.html`

### GAP-CRM-ACCOUNTS-01  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed load the table card shows the "Couldn't load — showing nothing" badge and, directly beneath it, the EmptyState "No accounts yet — Create an account…", and Account Hierarchy says "No hierarchy yet"; both read as facts about an empty master rather than an outage (app/(app)/crm/accounts/AccountsTable.tsx:54, app/(app)/crm/accounts/AccountHierarchy.tsx:16).
- **Verified evidence:** accounts/page.tsx:9 gets {data, source}; on error data=[] (apiClient.ts fetchJson returns empty+source:'error'). AccountsTable.tsx:41-51 renders DataSourceBadge (provenance 'error-no-data' -> "Couldn't load — showing nothing") and then, because tableRows.length===0, EmptyState 'No accounts yet / Create an account...' (AccountsTable.tsx:49-54). AccountHierarchy.tsx:16 receives only `accounts` (no source) so it shows 'No hierarchy yet / Accounts appear here once the organisation master has entries'. Stat cards already use '—' (page.tsx:14) so only the two panels mask the outage. RefreshErrorState exists (app/_components/ds/RefreshErrorState.tsx) but is not used on this route.
- **Files to change:** `apps/web/src/app/(app)/crm/accounts/AccountsTable.tsx`, `apps/web/src/app/(app)/crm/accounts/AccountHierarchy.tsx`, `apps/web/src/app/(app)/crm/accounts/page.tsx`
- **Fix steps:**
  1. In AccountsTable.tsx, when provenance === 'error-no-data' render <RefreshErrorState error={toHumanError('load', {area:'accounts'})} backHref='/crm' /> (import from ds and @/lib/messages) instead of the EmptyState; keep EmptyState only for provenance 'live' with zero rows.
  2. Keep DataSourceBadge only for the 'cached' case (avoid the badge + error state double message).
  3. Pass `source` from page.tsx into <AccountHierarchy source={source} accounts={...}> and return null (or a compact RefreshErrorState) when source === 'error' and accounts is empty; do not render 'No hierarchy yet' on error.
  4. Optionally disable/hint the 'New Account' parent select when source==='error' since its options list would be empty.
  5. Add component tests for both components: source='error' + [] shows retry, not the empty copy.
- **Acceptance:**
  - Component test: AccountsTable with source='error', accounts=[] and no cache renders a Retry button and does not contain 'No accounts yet'.
  - Component test: AccountHierarchy with source='error' does not contain 'No hierarchy yet'.
  - Manual: block /api/v1/crm/accounts, load /crm/accounts: stats show '—', one error panel with Retry; clicking Retry re-fetches (router.refresh).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Must keep the cached-data path (useSeededResource 'cached' provenance) unchanged so offline users still see saved rows.
- **Depends on:** RefreshErrorState

### GAP-CRM-ACCOUNTS-02  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Hierarchy helper documents that "the API caps the list", yet Total Accounts / Linked Contacts / Sectors are computed from the returned page with no total or "showing N of M" cue, so they can silently undercount (app/(app)/crm/accounts/hierarchy.ts:10, app/(app)/crm/accounts/page.tsx:13).
- **Verified evidence:** Real on the client side: page.tsx:9-13 and :47-53 compute Total Accounts, Linked Contacts (sum of contactCount), Sectors from the array only, and mapCrmAccounts (app/_data/apiMappers.ts:558-577) returns a bare CRMAccountSummary[] and discards any total/next-cursor field, so the UI has no way to show 'N of M'. hierarchy.ts:10 comment states 'the API caps the list'. Whether the accounts endpoint actually caps or returns a total cannot be verified: CRM service and @civitasone/schemas (crmAccountsListSchema) are not in the snapshot. Note also Linked Contacts sums only listed accounts.
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/crm/accounts/page.tsx`, `apps/web/src/app/(app)/crm/accounts/AccountsTable.tsx`
- **Fix steps:**
  1. Confirm with the CRM backend whether GET /api/v1/crm/accounts returns a total/limit/nextCursor (and its default page cap); if not, raise a backend ticket to add it.
  2. Extend getCrmAccounts/mapCrmAccounts to keep `total` (and `truncated = rows.length < total`) in the loader result alongside data.
  3. In page.tsx show a 'Showing N of M accounts' hint (or aria-live note) under the stat grid and mark the derived stats ('Linked Contacts', 'Sectors') as 'in loaded accounts' when truncated.
  4. If the backend cannot return a total, add server-side aggregates endpoint for stats, or render '500+' style copy when rows.length equals the known page cap.
  5. Add mapper unit test: payload {data:[...], total: 120} preserves total.
- **Acceptance:**
  - Unit test: mapCrmAccounts/loader exposes total when the payload contains it.
  - Component/page test: with total > rows.length the page shows 'Showing 100 of 120' and stats are labelled as partial.
  - Manual: seed more accounts than the cap; stats never present a silent undercount.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low UI risk; depends on backend contract. Do not invent a total field until the API confirms it.

### GAP-CRM-ACCOUNTS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W1 SF-14a re-confirmed against main d0b65c3b5 (feature still present after the Field/Input conversion): closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** New account is two writes (POST then PATCH parent). If the PATCH fails the form closes with a success-styled "Account created…" message and only a hint that the parent was not set; nothing offers a retry (app/(app)/crm/accounts/NewAccountForm.tsx:48).
- **Verified evidence:** NewAccountForm.tsx:38-47 POSTs v1/crm/accounts, then (only if form.parentId && body.id) PATCHes v1/crm/accounts/{id}/parent. On PATCH failure (:49-56) it sets message 'Account created. The parent could not be set — you can set it from the account page.', closes the form and refreshes; the message is rendered in the green role=status paragraph (:120-122, colour #047857), with no retry action. Two extra defects found: (a) the form state is NOT reset on this path (setForm reset is only on the success path, :60), so re-opening shows the old values and a resubmit creates a duplicate; (b) if the 202 body has no `id`, the parent step is skipped silently and the user sees the plain success message with no hint the parent was dropped.
- **Files to change:** `apps/web/src/app/(app)/crm/accounts/NewAccountForm.tsx`
- **Fix steps:**
  1. Track outcome in state: 'created' | 'created-parent-failed' | 'created-parent-skipped'; render parent-failed/skipped in a warning style (role='alert', amber) not the green success style.
  2. Keep the created account id in state and render a 'Retry setting parent' Button that re-sends only the PATCH (do not re-POST).
  3. Reset the form in every path where the account was created (move setForm reset before the parent step) so reopening cannot re-create it.
  4. Handle `!body.id && form.parentId` explicitly: show the warning 'Account created; parent could not be set yet' with a link to /crm/accounts.
  5. Add tests: PATCH 500 shows warning + Retry; Retry calls PATCH only once with the same id.
- **Acceptance:**
  - Component test: mock POST 202 {id:'a1'} and PATCH 500 -> warning role=alert containing 'parent', a Retry button, and form values cleared.
  - Component test: clicking Retry with PATCH 200 shows success and no second POST is made.
  - Component test: POST 202 with {} and a parent chosen shows a warning not the plain success text.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Long term a single backend command accepting parentId would remove the two-write problem (backend follow-up).

### GAP-CRM-ACCOUNTS-04  ·  MEDIUM  ·  partly  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13, W1 SF-14a re-confirmed against main d0b65c3b5 (feature still present after the Field/Input conversion): closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Create is queue-backed (202): the new row does not appear until the consumer runs, but router.refresh() is called immediately, so a user can submit twice and create a duplicate; neither the form nor browserFetch sets an idempotency key (browserClient.ts sends only device headers) (app/(app)/crm/accounts/NewAccountForm.tsx:50).
- **Verified evidence:** NewAccountForm.tsx:50-55 POSTs with headers only from browserFetch (browserClient.ts:22-34 adds content-type + x-device-id/trust); no idempotency header is set, although the BFF proxy already forwards x-idempotency-key (app/api/proxy/[...path]/route.ts:7) and finance JournalEntryForm.tsx:74,159 shows the pattern. router.refresh() is called right after the 202 (:62) so the new row is not yet listed. Overstated: the submit Button is disabled/loading while busy (:110-112) and the form closes and resets after success, so an accidental double-click is already blocked; duplicates need the user to reopen the form and re-enter. There is no zod validation at the form boundary (only `required` on name; website free text). Backend queue/idempotency behaviour cannot be verified (CRM service absent).
- **Files to change:** `apps/web/src/app/(app)/crm/accounts/NewAccountForm.tsx`, `apps/web/src/app/(app)/crm/accounts/newAccountSchema.ts`
- **Fix steps:**
  1. Generate one crypto.randomUUID() idempotency key per form-open (useState/useRef) and send it as headers {'x-idempotency-key': key} on the POST (same as JournalEntryForm); rotate it after a confirmed success or when the form is reopened fresh.
  2. Add a zod schema (name trimmed 2-200 chars, website optional URL http/https, industry optional) in newAccountSchema.ts and validate in submit() before the POST; show field-level errors with aria-invalid.
  3. Optionally pre-check the typed name against the loaded `accounts` prop (case-insensitive) and warn 'An account with this name already exists' since the new row is invisible until the consumer runs.
  4. Confirm with backend that the accounts create route honours x-idempotency-key; if not, raise a backend ticket.
- **Acceptance:**
  - Unit test: two consecutive submissions of the same open form send the same x-idempotency-key header.
  - Unit test: invalid website 'foo' blocks submit and shows an inline error; POST not called.
  - Manual: submit an existing name -> duplicate warning appears before the request.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium-low: sending an idempotency key the server ignores is harmless; a stricter URL schema could reject legitimate bare-domain input, so normalise (prepend https://) rather than reject.

### GAP-CRM-ACCOUNTS-06  ·  LOW  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Hierarchy uses role="tree"/"treeitem" with aria-selected={false} but has no roving focus or arrow-key handling, so it is announced as a widget it does not behave as (app/(app)/crm/accounts/AccountHierarchy.tsx:19).
- **Verified evidence:** AccountHierarchy.tsx:19-21 renders <ul role='tree'> with <li role='treeitem' aria-selected={false} aria-level=...>. There is no tabIndex/roving focus, no aria-expanded and no key handler anywhere in the component; items are flat (depth by padding-left) with an <a> inside each. Assistive tech announces a tree widget with arrow-key semantics that do not exist.
- **Files to change:** `apps/web/src/app/(app)/crm/accounts/AccountHierarchy.tsx`
- **Fix steps:**
  1. Remove role='tree', role='treeitem', aria-selected and aria-level; the links are ordinary navigation.
  2. Render true nesting: build children arrays from buildAccountTree (hierarchy.ts) and emit nested <ul><li> so screen readers announce list depth natively; keep aria-label='Account hierarchy' on a <nav>/<ul>.
  3. Add visually hidden text for depth if nested lists are not used (e.g. '<span class=sr-only>Level 2</span>').
- **Acceptance:**
  - Component test: rendered markup contains no role='tree' / role='treeitem'.
  - Component test: a child account is inside a nested <ul> under its parent <li>.
  - Manual with a screen reader: announced as a list with nesting, Tab moves link to link.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Purely markup; existing tests that query role='treeitem' need updating.

### GAP-CRM-ACCOUNTS-07  ·  LOW  ·  partly  ·  theme I18N (was FABRICATED)

- [x] **Status** (W2 2026-10-16: closed by #N, W2 crm: closed by #N)
- **W0-10 note:** review found the W0 tick partly — accounts/activities fixed (subtitle via t()), but acceptance 'no Devanagari literals remain in crm/**/*.tsx' fails: crm/contacts/page.tsx:97 ('संपर्क पंजी') and crm/deals/page.tsx:12 ('संलग्नताएँ') still hard-coded
- **First-pass claim:** Subtitle carries a hard-coded Devanagari suffix (संगठन पंजी) instead of a next-intl key, and for an Odisha tenant would be expected in Odia (app/(app)/crm/accounts/page.tsx:34).
- **Verified evidence:** accounts/page.tsx:34 subtitle is a literal string ending '• संगठन पंजी' (Devanagari) and activities/page.tsx:22 has the same pattern ('• अन्तःक्रियाएँ'); neither uses next-intl. Correction: Odia is not a supported locale at all (src/i18n/config.ts:12 SUPPORTED_LOCALES = en, hi, ta, te, kn), so 'expected in Odia' is not currently actionable; the real defect is a hard-coded Hindi suffix shown to every locale/tenant (a Tamil/English user sees Hindi text) and it is not FABRICATED data.
- **Files to change:** `apps/web/src/app/(app)/crm/accounts/page.tsx`, `apps/web/src/app/(app)/crm/activities/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Add keys crm.accounts.subtitle and crm.activities.subtitle to messages/en.json (English only text) and the Hindi equivalents in hi.json (the Devanagari phrases move there).
  2. In each page call `const t = await getTranslations('crm')` (pattern in crm/page.tsx:1,76) and pass subtitle={t('accounts.subtitle')}.
  3. Remove the '•' + Devanagari suffix from the English string.
  4. Product decision: whether to add an Odia (or) locale to SUPPORTED_LOCALES is out of scope here; record it as a separate item.
- **Acceptance:**
  - Unit/page test: with locale en the subtitle contains no Devanagari characters; with hi it renders the Hindi string.
  - Grep test: no Devanagari literals remain in apps/web/src/app/(app)/crm/**/*.tsx.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Missing-key fallback in ta/te/kn is graceful per i18n/config.ts.

### GAP-CRM-ACCOUNTS-08  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Parent not in the list is rendered as "Reports to another account", giving no clue which one (app/(app)/crm/accounts/AccountsTable.tsx:38).
- **Verified evidence:** AccountsTable.tsx:38 builds hierarchy as `Reports to ${nameById.get(a.parentId) ?? 'another account'}`; nameById (:35) is built only from the loaded rows, so any parent outside the (possibly capped or cached) list shows the generic text with no name or link. The row itself is a link to the account, and CRMAccountSummary carries only parentId (no parent name). The account detail page has an ancestors loader (getCrmAccountAncestors, loaders.ts:1431) so names are obtainable but not on this list.
- **Files to change:** `apps/web/src/app/(app)/crm/accounts/AccountsTable.tsx`
- **Fix steps:**
  1. Change the copy for the missing-parent case to 'Reports to a parent not shown here' and render it with a render() cell that links to /crm/accounts/{parentId} (stop propagation so it does not conflict with rowHref).
  2. Better: ask the backend to include parentName in the list DTO; then map it in mapCrmAccounts (apiMappers.ts:567) and use it as the fallback.
  3. Add a test: parent absent from rows shows the fallback text with a link to the parent's id route.
- **Acceptance:**
  - Component test: account with parentId 'p9' not in rows renders a link with href '/crm/accounts/p9'.
  - Component test: parent present in rows still shows 'Reports to <name>'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Nested links inside a rowHref row need click propagation handled.
- **Depends on:** GAP-CRM-ACCOUNTS-02


---
## /crm/accounts/[id]  —  `crm/accounts-detail.html`

- **Source:** `apps/web/src/app/(app)/crm/accounts/[id]/page.tsx`
- **Design reference:** `redesign/crm/accounts-detail.html`

### GAP-CRM-ACCOUNTS-DETAIL-01  ·  HIGH  ·  partly  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Account is resolved with accounts.find over the list response, which hierarchy.ts documents as API-capped; a valid deep link to an account beyond the cap renders "Account not found — does not exist or is no longer active" (app/(app)/crm/accounts/[id]/page.tsx:34, app/(app)/crm/accounts/hierarchy.ts:10).
- **Verified evidence:** page.tsx:15-34 resolves the account via accounts.find over getCrmAccounts() (list, /api/v1/crm/accounts); hierarchy.ts:9-10 documents that the API caps the list. So a deep link beyond the cap would not be found. However, because ancestors/children are fetched by id (loaders.ts:1431-1448), a truly missing id probably errors first (RefreshErrorState) - and whether a GET /crm/accounts/:id exists or the cap size is cannot-verify (crm service not in snapshot).
- **Files to change:** `apps/web/src/app/(app)/crm/accounts/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm the backend has GET /api/v1/crm/accounts/:id; add getCrmAccount(id) loader with zod schema.
  2. Use it in page.tsx instead of accounts.find; 404 -> EmptyState/notFound, other errors -> RefreshErrorState.
  3. Load the (capped) list lazily only for the parent picker (or replace with a searchable async combobox).
- **Acceptance:**
  - Test: open account not present in first page of list -> renders detail.
  - Unknown id -> Account not found.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-ACCOUNTS-DETAIL-03

### GAP-CRM-ACCOUNTS-DETAIL-02  ·  HIGH  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** DocumentsPanel receives canVerify unconditionally, so verify/reject controls show for every crm_user; either the API 403s a normal user or document verification is not role-limited at all — no role check exists in the page or layout (app/(app)/crm/accounts/[id]/page.tsx:147).
- **Verified evidence:** page.tsx:147 passes canVerify (also contacts/[id]/page.tsx:89) unconditionally; DocumentsPanel shows Verify/Reject when canVerify (DocumentsPanel.tsx:328). Claim 'no role check in layout' is wrong: crm/layout.tsx:5-11 requireAnyRole(['crm_user','crm_admin','platform_admin','super_admin']) - but that is module access, not verify permission, so every crm_user sees Verify/Reject. Server enforcement cannot-verify (crm service absent).
- **Files to change:** `apps/web/src/app/(app)/crm/accounts/[id]/page.tsx`, `apps/web/src/app/(app)/crm/contacts/[id]/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. Define CRM_VERIFY_ROLES (e.g. crm_admin, platform_admin, super_admin - confirm with product/service policy).
  2. In both pages compute canVerify = getSessionRoles().some(r=>CRM_VERIFY_ROLES.includes(r)) and pass it.
  3. Confirm the documents verify endpoint returns 403 for others and DocumentsPanel surfaces it via useFormError.
- **Acceptance:**
  - Unit: crm_user -> no Verify/Reject; crm_admin -> shown.
  - API call as crm_user returns 403.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Approval control; UI hiding is not security - server must enforce.

### GAP-CRM-ACCOUNTS-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W1 SF-14a re-confirmed against main d0b65c3b5 (feature still present after the Field/Input conversion): closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Re-parenting has no ConfirmDialog although it moves the whole subtree in the hierarchy, and the parent select lists every account except itself — including its own descendants — so the only guard against a cycle is the server 422 (app/(app)/crm/accounts/[id]/page.tsx:61, app/(app)/crm/accounts/[id]/AccountParentForm.tsx:20).
- **Verified evidence:** AccountParentForm.tsx:79-95 submits PATCH /crm/accounts/:id/parent with no ConfirmDialog and no reason; options (page.tsx:61) exclude only the account itself, so descendants are selectable; CYCLE_DETECTED 422 handled at :55-57. Audit emission is a backend concern (cannot-verify). Suggestion of maker-checker is not appropriate for a hierarchy edit; a simple confirm is.
- **Files to change:** `apps/web/src/app/(app)/crm/accounts/[id]/AccountParentForm.tsx`, `apps/web/src/app/(app)/crm/accounts/[id]/page.tsx`
- **Fix steps:**
  1. Compute descendants from list (buildAccountTree in hierarchy.ts) or fetch and exclude them from options.
  2. Add ConfirmDialog before submit: 'Move X and its N sub-accounts under Y?'.
  3. Keep the CYCLE_DETECTED message as server backstop.
- **Acceptance:**
  - Unit: descendant not listed in options.
  - Confirm shown before PATCH; cancel makes no request.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; hierarchy edit is reversible.
- **Depends on:** GAP-CRM-ACCOUNTS-DETAIL-01

### GAP-CRM-ACCOUNTS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Three fetches are combined all-or-nothing: if only ancestors or children fail, the whole account (already loaded) is replaced by "We couldn't load account" (app/(app)/crm/accounts/[id]/page.tsx:25).
- **Verified evidence:** page.tsx:24-32 combineResourceState treats any of the three results being source 'error' as a full error (useResource.ts:54-61), replacing the loaded account with 'We couldn't load account.'.
- **Files to change:** `apps/web/src/app/(app)/crm/accounts/[id]/page.tsx`
- **Fix steps:**
  1. Make accounts result the gate; if accounts ok but ancestors/children error, render the page with those sections showing an inline RefreshErrorState/notice.
  2. Pass an ancestorsFailed/childrenFailed flag to the Reporting Line/Child Accounts cards.
- **Acceptance:**
  - Mock ancestors 503: account details render, Reporting Line shows retry.
  - All fail -> full error.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-ACCOUNTS-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme XSS (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Website is put straight into href with no scheme check; a stored "javascript:" value or a bare domain (relative link) would misbehave (app/(app)/crm/accounts/[id]/page.tsx:77).
- **Verified evidence:** page.tsx:77 `<a href={account.website}>`; apiMappers.ts:571 does toText only, no scheme validation. A stored javascript: URL would execute on click; bare domain becomes relative path. rel noopener/noreferrer and target _blank present.
- **Files to change:** `apps/web/src/app/(app)/crm/accounts/[id]/page.tsx`, `apps/web/src/lib/url.ts`
- **Fix steps:**
  1. Create safeExternalUrl(raw) helper: trim, prefix https:// if no scheme, allow only http/https, else return null.
  2. Use it in page.tsx (render plain text if null).
  3. Also validate website with zod at the create/edit form and backend boundary.
- **Acceptance:**
  - Unit: 'javascript:alert(1)' -> null; 'example.com' -> https://example.com.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; security hardening.

### GAP-CRM-ACCOUNTS-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme FILTER (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** "View contacts" links to /crm/contacts?search=<account name>, a free-text search, not an account filter, so similarly named organisations mix and renamed accounts lose their contacts (app/(app)/crm/accounts/[id]/page.tsx:133).
- **Verified evidence:** page.tsx:133 links to /crm/contacts?search=<account.name>; getCrmContacts (loaders.ts:1398-1412) has no accountId param, only free-text search, and contacts carry `account` as a name string. Similar names mix, renamed accounts lose contacts. Backend support for accountId filter cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/crm/accounts/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/crm/contacts/page.tsx`
- **Fix steps:**
  1. Confirm/add accountId filter on GET /crm/contacts.
  2. Add accountId to CrmContactsQuery and page SP; forward in getCrmContacts.
  3. Link with ?accountId=<id> and show a filter chip with account name.
- **Acceptance:**
  - Renamed account still lists its contacts; two similar names do not mix.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-ACCOUNTS-DETAIL-07  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Seven independent client panels load below the fold with their own spinners and errors; the loading.tsx skeleton is a single block and does not mirror the two-column layout (app/(app)/crm/accounts/[id]/loading.tsx:7).
- **Verified evidence:** [id]/loading.tsx:1-11 is a single h-64 block inside min-h-screen wrapper; page has g-main two columns plus 7 client panels (Customer360Panel, AccountRelationshipsEditor, ActivityFeed, CommunicationLog, AddressesEditor, DocumentAlertsView, DocumentsPanel) each with own spinner/error. Loading skeleton doesn't mirror layout.
- **Files to change:** `apps/web/src/app/(app)/crm/accounts/[id]/loading.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx: header skeleton, grid g-main with two column cards, three panel-height skeleton cards below (use .skeleton class).
  2. Drop min-h-screen/slate colours for tokens.
- **Acceptance:**
  - Loading shows two columns matching final layout; no shift.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-ACCOUNTS-DETAIL-08  ·  LOW  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Error copy reads "We couldn't load account." — the area noun lacks an article because toHumanError drops determiners by design (app/(app)/crm/accounts/[id]/page.tsx:29, lib/messages.ts:41).
- **Verified evidence:** page.tsx:29 toHumanError('load',{area:'account'}) and messages.ts:36-41 template `We couldn't load ${thing}.` intentionally omits determiners, giving 'We couldn't load account.'.
- **Files to change:** `apps/web/src/app/(app)/crm/accounts/[id]/page.tsx`
- **Fix steps:**
  1. Pass area: 'this account' or 'account details' (plural-safe) at page.tsx:29.
  2. Audit other callers using singular nouns.
- **Acceptance:**
  - Error text reads 'We couldn't load account details.'
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /crm/activities  —  `crm/activities.html`

- **Source:** `apps/web/src/app/(app)/crm/activities/page.tsx`
- **Design reference:** `redesign/crm/activities.html`

### GAP-CRM-ACTIVITIES-01  ·  HIGH  ·  confirmed  ·  theme VALIDATION (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The Log form offers Type "Site Visit" (value site_visit) and the subtitle promises site visits, but mapCRMActivityEntries only accepts call|meeting|email|task|note and silently skips any other row, so a saved site visit never appears in the list (app/(app)/crm/activities/LogActivityButton.tsx:97, app/_data/loaders.ts:3176).
- **Verified evidence:** LogActivityButton.tsx:97 offers <option value='site_visit'>, and the page subtitle (activities/page.tsx:22) promises site visits. mapCRMActivityEntries (app/_data/loaders.ts:3176) validTypes = call|meeting|email|task|note, and line 3186 `continue`s past any row with another type, so a saved site_visit never renders and is not counted in any stat. No other mention of site_visit exists in apps/packages (grep). Whether the backend accepts site_visit (and whether CRMActivityEntryListSchema in @civitasone/schemas or the CRMActivityEntry type in @civitasone/types allow it) cannot be verified, those packages are absent. Related: the mapper is shared by no other screen, so widening it is local. The PII theme tag is wrong.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/crm/activities/LogActivityButton.tsx`, `apps/web/src/app/(app)/crm/activities/ActivitiesTable.tsx`, `packages/types (CRMActivityEntry type)`, `packages/schemas (CRMActivityEntryListSchema)`
- **Fix steps:**
  1. Confirm with the CRM service which activity types it stores. If site_visit is valid: add 'site_visit' to CRMActivityEntry['type'] and the zod schema, and to validTypes in mapCRMActivityEntries (loaders.ts:3176). If not valid: remove the option from LogActivityButton.tsx:97 and the 'site visits' wording in the subtitle.
  2. Add a shared ACTIVITY_TYPES constant (value + label) used by the form select, the mapper and the table so they cannot drift; render humanised labels (Site visit) in the table.
  3. Stop silently dropping unknown types: map them to 'task'/'note' fallback or keep the row with its raw type and log via the loader's emitError telemetry.
  4. Add a mapper unit test: a row with type 'site_visit' is returned.
- **Acceptance:**
  - Unit test: mapCRMActivityEntries([{id:'1', type:'site_visit', subject:'Visit'}]) returns one entry.
  - Manual: log a Site Visit, refresh; it appears in the table and increments Total Interactions.
  - Test that every <option> value in LogActivityButton is accepted by the mapper.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: silent data loss for users who already logged site visits; the type union lives in shared packages, so change it consistently.

### GAP-CRM-ACTIVITIES-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed load the badge and "—" stats say the load failed, yet the table below still shows "No interactions yet — Schedule your first call…" because ActivitiesTable never receives source (app/(app)/crm/activities/page.tsx:26, app/(app)/crm/activities/ActivitiesTable.tsx:64).
- **Verified evidence:** activities/page.tsx:26 renders DataSourceBadge when source==='error' and stats show '—' via stat() (:12), but line 36 passes only `activities` and `initialSegment` to ActivitiesTable (no source). ActivitiesTable.tsx:63-64 renders EmptyState 'No interactions yet — Schedule your first call...' whenever activities.length===0, so an outage looks like an empty register; the All/Today/Overdue Segmented control is still shown. Unlike accounts, this table does not use useSeededResource so there is no offline cache either.
- **Files to change:** `apps/web/src/app/(app)/crm/activities/page.tsx`, `apps/web/src/app/(app)/crm/activities/ActivitiesTable.tsx`
- **Fix steps:**
  1. Pass source into <ActivitiesTable source={source} ...>.
  2. In ActivitiesTable, when source==='error' && activities.length===0 render <RefreshErrorState error={toHumanError('load',{area:'interactions'})} backHref='/crm' /> and hide the Segmented control; keep EmptyState only for source==='api'.
  3. Drop the separate page-level DataSourceBadge in that case to avoid duplicated messaging (or keep it only for partial data).
  4. Add component tests for both branches.
- **Acceptance:**
  - Component test: source='error', activities=[] shows Retry and not 'No interactions yet'.
  - Component test: source='api', activities=[] still shows the empty state.
  - Manual: block /api/v1/crm/activities; page shows one error panel with working Retry.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Note ACTIVITIES-04: an empty valid list currently also maps to source:'error', fix that first or the empty tenant will always see the error panel.
- **Depends on:** RefreshErrorState, GAP-CRM-ACTIVITIES-04

### GAP-CRM-ACTIVITIES-03  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** "Today" is computed as new Date().toISOString().slice(0,10), i.e. the UTC date, in both the stat and the segment; between 00:00 and 05:30 IST an Odisha user sees yesterday's items as "Due Today" (app/(app)/crm/activities/page.tsx:14, app/(app)/crm/activities/ActivitiesTable.tsx:40).
- **Verified evidence:** activities/page.tsx:14 (server) and ActivitiesTable.tsx:40 (client) both use new Date().toISOString().slice(0,10), i.e. the UTC calendar date. Between 00:00 and 05:30 IST that is the previous IST day, so 'Due Today' and the Today segment match yesterday's dueDate. Two more issues: server (UTC host) and client (browser) can disagree, and the equality assumes dueDate is a bare YYYY-MM-DD (format not verifiable, schema absent). formatters.ts has formatIndianDate but no today-in-IST helper; lib/fiscalYear.ts already references Asia/Kolkata.
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/crm/activities/page.tsx`, `apps/web/src/app/(app)/crm/activities/ActivitiesTable.tsx`
- **Fix steps:**
  1. Add `todayIST(now = new Date()): string` to lib/formatters.ts using Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata'}).format(now) (YYYY-MM-DD), and export it.
  2. Compute `today` once on the server in page.tsx with todayIST() and pass it to ActivitiesTable as a prop, replacing the client-side new Date() (removes hydration/UTC mismatch).
  3. Use the same value for the dueToday stat (page.tsx:14) and the Today segment (ActivitiesTable.tsx:40); if dueDate can be a full ISO timestamp, compare on its IST date part.
  4. Also derive 'overdue' consistently or leave it to backend status; add unit tests with fake timers at 2026-03-10T19:00:00Z (00:30 IST 11 Mar) expecting today='2026-03-11'.
- **Acceptance:**
  - Unit test: todayIST at 2026-03-10T19:00:00Z returns '2026-03-11'.
  - Component test: with dueDate '2026-03-11' and that clock, the Today segment includes the row and the stat counts it.
  - Manual: browser TZ set to UTC at 01:00 IST shows the IST-correct 'Due Today' set.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Shared todayIST helper should be reused for other UTC-slice usages (grep toISOString().slice(0,10)).

### GAP-CRM-ACTIVITIES-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Mapper returns null when every row is invalid or the list is empty, and skips rows with an unknown status; a "cancelled" activity is valid but counted by none of the four stat cards or the segments (app/_data/loaders.ts:3177).
- **Verified evidence:** Confirmed and worse than stated: mapCRMActivityEntries (loaders.ts:3172-3200) `continue`s past rows with unknown type or status (:3186) and ends `return mapped.length > 0 ? mapped : null` (:3199); fetchJson (apiClient.ts:154-158) treats a null map as invalid_payload and returns {data: [], source:'error'}, so a legitimately EMPTY activity list is reported as 'Couldn't load' with '—' stats. Overstated part: 'cancelled' is valid (validStatuses :3177) and is counted in Total Interactions (activities.length) and the All segment; it is just excluded from Due Today/Overdue/Completed and there is no card for open/cancelled. Rows with statuses like in_progress/done are silently dropped entirely.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/crm/activities/page.tsx`, `apps/web/src/app/(app)/crm/activities/ActivitiesTable.tsx`
- **Fix steps:**
  1. In mapCRMActivityEntries return `mapped` (even when empty) when the source array was valid; return null only if `rows` is not an array (compare with mapTicketDetails comment at ~loaders.ts:3251 which already treats empty as valid).
  2. Do not drop rows with unknown type/status: coerce to 'task'/'open' (or keep raw and display humanizeStatus) and call the loader's telemetry for the coerced count.
  3. Add an 'Open' stat or show 'Cancelled' in the Status filter; ensure Total = sum of visible categories or label it 'All interactions'.
  4. Add unit tests: [] -> [] (source api), status 'cancelled' kept, unknown status kept/coerced.
- **Acceptance:**
  - Unit test: mapCRMActivityEntries([]) returns [] not null; fetchJson then yields source 'api'.
  - Unit test: a cancelled row is returned and appears in the All segment.
  - Manual: tenant with zero activities sees 'No interactions yet' with no error badge.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Changes loader semantics for an empty list; verify nothing else keys on `source==='error'` for empty activities (dashboard uses a different loader, getActivities at loaders.ts:1459).

### GAP-CRM-ACTIVITIES-05  ·  LOW  ·  confirmed  ·  theme CAP (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Table has sortable only: no filter box, pagination or export, unlike Accounts, Contacts and Deals; a long register is one unbroken table (app/(app)/crm/activities/ActivitiesTable.tsx:77).
- **Verified evidence:** ActivitiesTable.tsx:77 passes only `sortable` to DataTable. DataTable supports filterable, filterPlaceholder, pageSize, and exportable (ds/DataTable.tsx:72-87,180-187). AccountsTable.tsx:70-73 uses sortable + filterable + pageSize={25}. The whole register is fetched in one call and rendered as one unpaginated table. The PII theme tag is wrong (it is a capability gap); if `exportable` is added it exports names/subjects of stakeholders, so it needs role gating and audit logging.
- **Files to change:** `apps/web/src/app/(app)/crm/activities/ActivitiesTable.tsx`
- **Fix steps:**
  1. Add filterable, filterPlaceholder='Filter interactions…' and pageSize={25} to the DataTable props (same as AccountsTable).
  2. Do NOT enable exportable until a decision on who may export stakeholder interaction data and an audit event exist; if enabled, gate by role and emit an export audit event server-side.
  3. Add a test that 30 rows render 25 plus pagination controls and the filter narrows by subject/owner.
- **Acceptance:**
  - Component test: 30 activities -> first page shows 25 rows and a next-page control.
  - Component test: typing an owner name in the filter reduces rows to matches.
  - Manual: filter and pagination still work together with the All/Today/Overdue segment.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Client-side filtering/paging only covers the fetched set (see ACCOUNTS-02 for capped-list concerns).

### GAP-CRM-ACTIVITIES-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W1 SF-14a re-confirmed against main d0b65c3b5 (feature still present after the Field/Input conversion): closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Contact picker failures are swallowed ("contact picker is optional"), so the select silently shows only "— No contact —" and a user cannot tell the list did not load (app/(app)/crm/activities/LogActivityButton.tsx:37).
- **Verified evidence:** LogActivityButton.tsx:32-46: on open it fetches v1/crm/contacts; `if (!res.ok) return;` (:37) and `catch { /* contact picker is optional */ }` swallow failures, so the <select> (:83-88) only ever shows '— No contact —' with no message, and the user may log an interaction unlinked to the contact they meant. Also loads the contacts list unpaginated on every open and shows no loading state.
- **Files to change:** `apps/web/src/app/(app)/crm/activities/LogActivityButton.tsx`
- **Fix steps:**
  1. Add state contactsStatus: 'idle'|'loading'|'ready'|'error'; set 'error' in both the !res.ok and catch branches.
  2. When 'error' show an inline role='status' note under the select: 'Contacts could not be loaded. You can still save, or Retry.' with a Retry Button that re-runs the fetch.
  3. When 'loading' disable the select and show 'Loading contacts…' as the first option.
  4. Consider replacing the select with the shared EntityPicker (search-as-you-type) if it exists, to avoid loading the full contact list.
- **Acceptance:**
  - Component test: contacts fetch returns 500 -> the error note and Retry are visible.
  - Component test: Retry with a 200 response populates options.
  - Component test: while pending the select is disabled.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-ACTIVITIES-07  ·  LOW  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Error/empty states inside the segment view fall back to DataTable's generic "No records found — There are no items to display yet." (app/(app)/crm/activities/ActivitiesTable.tsx:76).
- **Verified evidence:** ActivitiesTable.tsx:76-89 passes no emptyTitle/emptyMessage to DataTable, so DataTable's defaults 'No records found / There are no items to display yet.' (ds/DataTable.tsx:184-185) appear. Correction: this only happens when a segment filter yields zero rows (Today/Overdue with nothing due) because activities.length===0 is caught earlier by the page-specific EmptyState (:63-64); the error state never reaches DataTable. So the true defect is generic, non-contextual copy for empty segments, not an outage mask (that is ACTIVITIES-02).
- **Files to change:** `apps/web/src/app/(app)/crm/activities/ActivitiesTable.tsx`
- **Fix steps:**
  1. Pass emptyIcon/emptyTitle/emptyMessage to DataTable based on the segment, e.g. Today: 'Nothing due today', Overdue: 'No overdue interactions', All: 'No interactions'.
  2. Optionally add emptyAction to switch back to the All segment.
  3. Add a test per segment for the message.
- **Acceptance:**
  - Component test: segment 'Overdue' with no overdue rows shows 'No overdue interactions'.
  - Component test: the generic 'No records found' text never appears on this page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-ACTIVITIES-02

### GAP-CRM-ACTIVITIES-08  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W1 SF-14a re-confirmed against main d0b65c3b5 (feature still present after the Field/Input conversion): closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Page and stats are titled "Stakeholder Interactions" while the hub and nav call the route "Activities" and the dashboard quick link says "Activities" (app/(app)/crm/activities/page.tsx:21).
- **Verified evidence:** activities/page.tsx:21 PageHeader title='Stakeholder Interactions', stat 'Total Interactions' (:30), button '+ Log Interaction' (LogActivityButton.tsx:79) and empty state 'No interactions yet', whereas the CRM hub tile is 'Activities' (crm/page.tsx:14) and dashboard quick link is 'Activities' (crm/dashboard/page.tsx:36). The API route and variable names also say activities. Terminology is inconsistent for one screen.
- **Files to change:** `apps/web/src/app/(app)/crm/activities/page.tsx`, `apps/web/src/app/(app)/crm/activities/LogActivityButton.tsx`, `apps/web/src/app/(app)/crm/activities/ActivitiesTable.tsx`, `apps/web/src/app/(app)/crm/page.tsx`, `apps/web/src/app/(app)/crm/dashboard/page.tsx`
- **Fix steps:**
  1. Decision: pick one term (recommend 'Activities' to match nav/URL/API, or rename hub+dashboard+nav to 'Interactions').
  2. Apply the chosen term to PageHeader title, StatCard 'Total ...', LogActivityButton button/heading and EmptyState titles; keep 'Stakeholder' only as descriptive subtitle text if wanted.
  3. Move the strings into next-intl keys while touching them (see ACCOUNTS-07).
- **Acceptance:**
  - Grep: only one of 'Activities'/'Interactions' is used as the screen name across hub, dashboard, header, breadcrumbs and buttons.
  - Snapshot/page test asserts the header equals the hub tile title.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; only user-facing copy and any test/e2e selectors that match the old title.


---
## /crm/agent-workload  —  `crm/agent-workload.html`

- **Source:** `apps/web/src/app/(app)/crm/agent-workload/page.tsx`
- **Design reference:** `redesign/crm/agent-workload.html`

### GAP-CRM-AGENT-WORKLOAD-01  ·  HIGH  ·  confirmed  ·  theme AUTHZ (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Every sibling assignment/config route redirects non-admins in a layout.tsx, but agent-workload has none; any crm_user who reaches the URL gets a fully wired capacity editor (set maxLeads, mark agents available/on leave) for platform-wide routing, and the hub tile is shown to everyone (app/(app)/crm/agent-workload/page.tsx:4 vs app/(app)/crm/assignment-rules/layout.tsx:11).
- **Verified evidence:** app/(app)/crm/agent-workload/ contains only error.tsx, loading.tsx, page.tsx (no layout.tsx). Siblings assignment-rules, assignment-directory, escalation-rules, task-escalation, custom-fields, dedup-rules etc. each have a layout.tsx calling requireAnyRole(['crm_admin','admin','super_admin','platform_admin','tenant_admin'], '/crm'). The parent crm/layout.tsx:5-9 only requires CRM_ROLES = crm_user|crm_admin|platform_admin|super_admin, and middleware.ts has no role rules. Hub tile 'Agent Workload' (crm/page.tsx:60) is shown to all. So any crm_user reaching /crm/agent-workload renders AgentWorkloadEditor, which PATCHes v1/crm/teams/agents/{id}/capacity (assignment.ts:334-340). Whether the backend also rejects non-admins cannot be verified (CRM service absent), but the UI gate is missing.
- **Files to change:** `apps/web/src/app/(app)/crm/agent-workload/layout.tsx`, `apps/web/src/app/(app)/crm/page.tsx`
- **Fix steps:**
  1. Create agent-workload/layout.tsx copying assignment-directory/layout.tsx: requireAnyRole(ALLOWED_ROLES, '/crm') with the same ALLOWED_ROLES list; extract that list into a shared CRM_ADMIN_ROLES constant (e.g. lib/auth/crmRoles.ts) and reuse it in all 10 sibling layouts.
  2. Hide admin-only hub tiles for non-admins (see ASSIGNMENT-DIRECTORY-07).
  3. Confirm/raise with backend that PATCH teams/agents/:id/capacity enforces crm_admin server-side (defence in depth).
  4. Add a layout test: crm_user is redirected to /crm; crm_admin renders children.
- **Acceptance:**
  - Unit test: requireAnyRole redirect is triggered for roles ['crm_user'] on the agent-workload layout.
  - Manual: sign in as crm_user, open /crm/agent-workload -> redirected to /crm.
  - Manual: crm_admin still opens the editor.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; but verify tenant_admin/admin roles are the correct set so legitimate admins are not locked out.
- **Depends on:** GAP-CRM-ASSIGNMENT-DIRECTORY-07

### GAP-CRM-AGENT-WORKLOAD-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Saving one row calls load() which replaces all rows from the server, discarding unsaved edits the user made on other rows (app/_components/crm/AgentWorkloadEditor.tsx:72).
- **Verified evidence:** AgentWorkloadEditor.tsx:72 calls `await load()` after a successful save; load() (:34-40) does setSource('loading') which makes the component return only the 'Loading agent workload…' paragraph (:88-94), then setAgents(data) replaces all rows from the server. Any unsaved edits (maxLeads, available, onLeave) on other rows are discarded, the table unmounts (focus lost) and the success message set after the reload. Same pattern in OwnershipDirectoryEditor (see ASSIGNMENT-DIRECTORY-05/06).
- **Files to change:** `apps/web/src/app/_components/crm/AgentWorkloadEditor.tsx`
- **Fix steps:**
  1. After a successful PATCH, refresh only the saved row: replace that agent with the server row (or update in place and keep the other rows' local edits); use a background refetch that does not set source='loading'.
  2. Track per-row `dirty` (compare against a `saved` snapshot) and merge server data only into non-dirty rows on reload.
  3. Only show the full-page loading paragraph on the first load, not on refreshes.
  4. Add a test: edit rows A and B, save A, B's edit remains.
- **Acceptance:**
  - Component test: change agent B's maxLeads, save agent A, B still shows the edited (unsaved) value.
  - Component test: table stays mounted during a post-save refresh (no 'Loading agent workload…' flash).
  - Manual: keyboard focus stays on the Save button after saving.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low-medium: merging server and local state must still surface server-normalised values for the saved row.

### GAP-CRM-AGENT-WORKLOAD-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Capacity 0 is accepted (min 0) and the over-capacity pill is suppressed for 0, but no help text says whether 0 means "unlimited" or "receives nothing" — a wrong guess silently stops routing to that agent (app/_components/crm/AgentWorkloadEditor.tsx:120, app/_components/crm/AgentWorkloadEditor.tsx:135).
- **Verified evidence:** AgentWorkloadEditor.tsx:117-125 input has min={0} and sanitizeInt (:24-28) accepts 0; the over-capacity flag at :103 requires `a.maxLeads > 0`, implying the UI treats 0 as 'no cap', but no label, hint or tooltip says what 0 means, and the header is just 'Max leads'. Also normaliseAgents (assignment.ts:310) does num(r.maxLeads) so a missing maxLeads from the API becomes 0 and would be saved back as 0 on the next Save. What the routing engine does with 0 (unlimited vs none) cannot be verified; CRM assignment service absent.
- **Files to change:** `apps/web/src/app/_components/crm/AgentWorkloadEditor.tsx`, `apps/web/src/lib/crm/assignment.ts`
- **Fix steps:**
  1. Get the backend meaning of maxLeads=0 (unlimited or blocked) and document it in the header: add a HelpTip (ds/HelpTip) on the 'Max leads' column, e.g. '0 = no limit' or '0 = receives no new leads'.
  2. Show the effective state in the row (e.g. 'No limit' pill) when 0, matching the semantics.
  3. In normaliseAgents keep maxLeads as NaN/undefined when the field is absent (not 0) so unsaved-missing data cannot be PATCHed as 0; disable Save until the user enters a value.
  4. Add tests for the help text and for the missing-field case.
- **Acceptance:**
  - Component test: 'Max leads' header exposes help text describing the value 0.
  - Unit test: normaliseAgents({agentId:'a'}) gives maxLeads that is not 0 (or flagged missing).
  - Manual: entering 0 shows the documented effect label.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Medium: wrong capacity semantics can silently stop or flood lead routing to an agent; confirm with product/backend before choosing the copy.

### GAP-CRM-AGENT-WORKLOAD-04  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Availability and leave changes alter who receives every new lead but there is no confirmation, reason or visible audit trail on the page (the mutation is a bare PATCH) (lib/crm/assignment.ts:335).
- **Verified evidence:** assignment.ts:334-340 updateAgentCapacity issues a bare PATCH v1/crm/teams/agents/{id}/capacity with {maxLeads, available, onLeave}; AgentWorkloadEditor.tsx:60-75 saves immediately on the row Save click with no ConfirmDialog, no reason and no history view; the only feedback is `${name}'s capacity saved.` Confirmed as a UI gap. Whether the backend emits an audit event cannot be verified (CRM service absent), so 'no audit trail' is only true on the page. Precedent in the same module: transferOwnership (assignment.ts:274-285) requires a reason, and ConfirmDialog supports requireReason/minReasonLength. 'maker≠checker' is a policy decision, not evidenced as required for this action.
- **Files to change:** `apps/web/src/app/_components/crm/AgentWorkloadEditor.tsx`, `apps/web/src/lib/crm/assignment.ts`
- **Fix steps:**
  1. Product decision: which changes need a reason (recommended: turning available off, onLeave on, or lowering maxLeads).
  2. For those, open <ConfirmDialog requireReason minReasonLength={5}> from save(); pass the reason as `reason` in CapacityPatch and updateAgentCapacity body.
  3. Ask backend to accept `reason` and write an audit event (actor, agent, before/after); if it exists already, add a small 'Last changed by/at' column from its response.
  4. Add tests: unavailable toggle -> dialog appears; confirm sends reason; cancel sends nothing.
- **Acceptance:**
  - Component test: toggling On leave then Save opens a dialog requiring a reason; PATCH is not sent until confirmed.
  - Component test: the PATCH body includes the reason.
  - Backend check: an audit event is recorded for the capacity change.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: routing changes affect who receives every new lead; an added backend field must be optional to keep older API compatible.
- **Depends on:** GAP-CRM-AGENT-WORKLOAD-01

### GAP-CRM-AGENT-WORKLOAD-05  ·  LOW  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Agent falls back to the raw agentId when name is missing, so a UUID can appear as the agent (lib/crm/assignment.ts:308).
- **Verified evidence:** assignment.ts:308 `name: str(r.name) || agentId`; AgentWorkloadEditor.tsx:107 renders {a.name} in the first cell and setError/setMessage use agent.name (:63, :73), so when the API omits name a raw agentId (likely a UUID) is shown as the agent identity in the table and toasts. It is a fallback path, it depends on the API omitting name (unverifiable).
- **Files to change:** `apps/web/src/lib/crm/assignment.ts`, `apps/web/src/app/_components/crm/AgentWorkloadEditor.tsx`
- **Fix steps:**
  1. In normaliseAgents fall back through r.displayName, r.fullName, r.email before agentId; otherwise use a non-ID placeholder such as 'Unnamed agent' and keep agentId only as row key.
  2. Ask backend to always return the agent's display name in teams/agents (join with directory/users).
  3. Optionally show the agentId in a title attribute/sr-only text for support, not as the label.
  4. Add a normaliser unit test: no name -> 'Unnamed agent'.
- **Acceptance:**
  - Unit test: normaliseAgents({agentId:'3f2a-...'}).name is not the id.
  - Component test: table cell and save message show the fallback label, not a UUID.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low. Rows still keyed by agentId.

### GAP-CRM-AGENT-WORKLOAD-06  ·  LOW  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Row controls are labelled by position ("Max leads for agent 3") and every Save button reads just "Save"; screen-reader users cannot tell whose row they are editing after a sort or reload (app/_components/crm/AgentWorkloadEditor.tsx:132).
- **Verified evidence:** AgentWorkloadEditor.tsx:132 label 'Max leads for agent {n}' where n = index+1 (:98), checkboxes aria-label 'Available for agent {n}' / 'On leave for agent {n}' (:142,:149), and every Save button is just 'Save' with no aria-label (:154-156). The name is in a plain <td> not a row header (:107). After any reload the index-to-agent mapping can change, and the screen-reader user hears positions rather than names. Not an i18n issue (theme corrected).
- **Files to change:** `apps/web/src/app/_components/crm/AgentWorkloadEditor.tsx`
- **Fix steps:**
  1. Use the agent name in labels: `Max leads for ${a.name}`, `Available: ${a.name}`, `On leave: ${a.name}`.
  2. Add aria-label={`Save capacity for ${a.name}`} to the Save Button.
  3. Make the name cell <th scope='row'> so the row is identifiable.
  4. Same treatment in OwnershipDirectoryEditor.tsx:155,166,171,180 ('Name for entry n', 'Enable entry n', 'Delete entry n') using the row's name when present.
  5. Move the strings into next-intl keys with a {name} placeholder.
- **Acceptance:**
  - Component test: getByRole('spinbutton', {name: /Max leads for Asha/}) finds the input.
  - Component test: getByRole('button', {name: 'Save capacity for Asha'}) exists.
  - axe check on the table has no violations.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Update existing tests that query 'Max leads for agent 1'.

### GAP-CRM-AGENT-WORKLOAD-07  ·  LOW  ·  partly  ·  theme STATE (was CAP)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Load happens client-side on mount with a bare text line; unlike server-loaded CRM lists there is no cached copy or offline fallback (app/_components/crm/AgentWorkloadEditor.tsx:84).
- **Verified evidence:** Accurate description: AgentWorkloadEditor.tsx:44-51 loads via getAgents() (browserFetch) in useEffect, and shows a bare 'Loading agent workload…' paragraph (:88-94) with no skeleton; agent-workload/page.tsx is a static server component so nothing is server-seeded and there is no useSeededResource/offline cache (unlike accounts). Overstated as a defect: this is an admin configuration screen where a stale cached capacity table could be misleading, and failure is handled with 'Workload unavailable' + badge (:113-119). The real improvement is a proper loading skeleton and not resetting to the loading state on refresh (ties to WORKLOAD-02).
- **Files to change:** `apps/web/src/app/_components/crm/AgentWorkloadEditor.tsx`
- **Fix steps:**
  1. Replace the bare text with the shared Skeleton (ds/Skeleton) table placeholder for the first load.
  2. Do not add an offline cache for this screen (config data must be live); state this as an intentional decision in the file header comment.
  3. For error use RefreshErrorState-style Retry that calls load() instead of a static 'Workload unavailable' message.
- **Acceptance:**
  - Component test: while the fetch is pending a skeleton with role='status' is shown.
  - Component test: error state offers a Retry button that re-invokes getAgents.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-AGENT-WORKLOAD-02


---
## /crm/assignment-directory  —  `crm/assignment-directory.html`

- **Source:** `apps/web/src/app/(app)/crm/assignment-directory/page.tsx`
- **Design reference:** `redesign/crm/assignment-directory.html`

### GAP-CRM-ASSIGNMENT-DIRECTORY-01  ·  MEDIUM  ·  confirmed  ·  theme COPY (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Singular forms are made with label.replace(/s$/, ""), so the Territories tab shows "+ Add territorie" and placeholder "Territorie name", and Branches shows "+ Add branche" (app/_components/crm/OwnershipDirectoryEditor.tsx:161, lib/crm/assignment.ts:211).
- **Verified evidence:** OwnershipDirectoryEditor.tsx:161 placeholder `${label.replace(/s$/, '')} name` and :193 `+ Add ${label.replace(/s$/, '').toLowerCase()}`. Labels come from OWNERSHIP_RESOURCE_LABELS (assignment.ts:209-214): Queues->'Queue', Partners->'Partner', but Territories->'Territorie' and Branches->'Branche'. So the Territories tab shows '+ Add territorie' and placeholder 'Territorie name'; Branches shows '+ Add branche'. Not fabricated data, so theme corrected.
- **Files to change:** `apps/web/src/lib/crm/assignment.ts`, `apps/web/src/app/_components/crm/OwnershipDirectoryEditor.tsx`
- **Fix steps:**
  1. Add OWNERSHIP_RESOURCE_SINGULAR: Record<OwnershipResource,string> = {'assignment-queues':'Queue', territories:'Territory', partners:'Partner', branches:'Branch'} next to the labels in assignment.ts.
  2. Replace both label.replace(/s$/,'') usages (lines 161, 193) with the map.
  3. Also fix the empty-state text `No ${label.toLowerCase()} yet` (fine) and dialog text if singular is used elsewhere.
  4. Add a test iterating all four resources asserting button text '+ Add queue|territory|partner|branch'.
- **Acceptance:**
  - Component test: Territories tab shows '+ Add territory' and placeholder 'Territory name'.
  - Component test: Branches tab shows '+ Add branch'.
  - Grep: no `.replace(/s$/` remains in OwnershipDirectoryEditor.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-ASSIGNMENT-DIRECTORY-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** When a tab fails to load, rows are [] so the tab shows "No queues yet — Add queues…" beside the error badge and keeps "+ Add queue" enabled; an admin can re-create entries that exist and duplicate them (app/_components/crm/OwnershipDirectoryEditor.tsx:137, lib/crm/assignment.ts:5).
- **Verified evidence:** getResources (assignment.ts:241-249) returns {data: [], source:'error'} on failure. In ResourceTable (OwnershipDirectoryEditor.tsx:127-137) the header shows DataSourceBadge when source==='error' but rows.length===0 renders EmptyState 'No queues yet — Add queues used to route and own leads.', and the '+ Add queue' button (:192-194) stays enabled. The admin can add and Create an entry that already exists on the server (unique-name enforcement by the backend cannot be verified) and, after Create, load() may still fail.
- **Files to change:** `apps/web/src/app/_components/crm/OwnershipDirectoryEditor.tsx`
- **Fix steps:**
  1. When source==='error' render <RefreshErrorState>-style error with a Retry that calls load() (component is client-side so use ErrorState with onRetry={() => load()} from ds/ErrorState).
  2. Hide/disable the '+ Add' button and all Save/Create actions while source==='error'.
  3. Show EmptyState only when source==='api' and rows.length===0.
  4. Add tests for error vs empty.
- **Acceptance:**
  - Component test: getResources -> source 'error' renders Retry and no '+ Add' button, no 'No queues yet'.
  - Component test: Retry that succeeds shows the rows.
  - Component test: source 'api' with [] shows 'No queues yet' and Add is enabled.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; risk of the current behaviour is duplicate directory entries affecting lead routing.
- **Depends on:** RefreshErrorState/ErrorState

### GAP-CRM-ASSIGNMENT-DIRECTORY-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The interface comment says extra backend fields are "carried through opaquely", but normaliseResources copies only id, name, description, enabled and updateResource PUTs that body, so any other stored field would be overwritten on save (lib/crm/assignment.ts:216, lib/crm/assignment.ts:234).
- **Verified evidence:** Client-side facts confirmed: the interface comment (assignment.ts:216) says extra backend fields are 'carried through opaquely', but normaliseResources (:224-239) copies only id, name, description, enabled, and saveRow (OwnershipDirectoryEditor.tsx:77-82) builds the body from those four fields again, which updateResource PUTs (assignment.ts:256-263). The impact (overwriting/clearing other stored fields, e.g. parent territory, region, capacity) depends on PUT semantics and on which extra fields exist, neither of which is verifiable here (CRM service absent). The comment is wrong either way.
- **Files to change:** `apps/web/src/lib/crm/assignment.ts`, `apps/web/src/app/_components/crm/OwnershipDirectoryEditor.tsx`
- **Fix steps:**
  1. Ask backend for the actual DTO of queues/territories/partners/branches and whether PUT is replace-all.
  2. If extra fields exist: add an `extra: Record<string, unknown>` to NamedResource, fill it in normaliseResources with the unknown keys, and spread it into the PUT body in saveRow; or expose the extra fields as editable columns.
  3. If none exist: correct the comment at assignment.ts:216 to remove the 'carried through opaquely' claim.
  4. Add a normaliser test: {id, name, description, enabled, region:'X'} round-trips region into the PUT body.
- **Acceptance:**
  - Unit test: normaliseResources keeps unknown fields under `extra` (if backend has them).
  - Component test: Save on a row with extra field sends it unchanged in the PUT body.
  - Comment matches behaviour.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium if extra fields exist: each admin save would wipe them, which affects routing data.

### GAP-CRM-ASSIGNMENT-DIRECTORY-05  ·  LOW  ·  confirmed  ·  theme STATE (was NAVUX)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Switching tabs remounts the table (key={resource}) and drops unsaved edits or new rows without a warning (app/_components/crm/OwnershipDirectoryEditor.tsx:216).
- **Verified evidence:** OwnershipDirectoryEditor.tsx:210-218: <ResourceTable key={resource}> under <Tabs onChange={setActive}>. Changing the tab unmounts ResourceTable, so its local rows state (including edited fields and unsaved 'new-N' rows added via addRow, :66-68) is dropped with no prompt; each tab re-fetches on mount. Tabs (ds/Tabs.tsx) has no beforeChange guard. No unsaved-changes helper exists in the repo (grep for beforeunload/useUnsavedChanges found only unrelated forms).
- **Files to change:** `apps/web/src/app/_components/crm/OwnershipDirectoryEditor.tsx`, `apps/web/src/app/_components/ds/Tabs.tsx`
- **Fix steps:**
  1. Have ResourceTable report `dirty` (rows differ from the last loaded snapshot, or any row without id) to the parent via an onDirtyChange prop.
  2. In OwnershipDirectoryEditor, intercept setActive: if dirty, open a ConfirmDialog 'Discard unsaved changes?' before switching (keep the old tab until confirmed).
  3. Alternative: keep all four tables mounted and hide the inactive ones (hidden attr) so edits persist across tabs.
  4. Add a beforeunload handler while dirty.
- **Acceptance:**
  - Component test: edit a name in Queues, click Territories -> confirm dialog appears; Cancel keeps Queues and the edit.
  - Component test: no dialog when nothing is dirty.
  - Manual: adding an unsaved row then switching tab does not silently discard it.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-ASSIGNMENT-DIRECTORY-06

### GAP-CRM-ASSIGNMENT-DIRECTORY-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Every row has its own Save; there is no dirty marker, so an admin cannot tell which of many edited rows are still unsaved (app/_components/crm/OwnershipDirectoryEditor.tsx:177).
- **Verified evidence:** OwnershipDirectoryEditor.tsx:177-179: each row has its own Save/Create button (`disabled={busy}` only), enabled regardless of whether the row changed; update() (:62-64) mutates local state without tracking a baseline, so there is no dirty marker or per-row 'unsaved' indication. Additionally saveRow ends with `await load()` (:88), which reloads the whole table and discards edits made in other rows (same defect as AGENT-WORKLOAD-02).
- **Files to change:** `apps/web/src/app/_components/crm/OwnershipDirectoryEditor.tsx`
- **Fix steps:**
  1. Keep a `saved` snapshot per row (Map key -> NamedResource) when loading; compute `dirty = name/description/enabled differ` per row (new rows always dirty).
  2. Render a visible marker (dot + text 'Unsaved') and set data-dirty on the row; disable Save when not dirty.
  3. After save, update only that row's snapshot/id instead of calling load() for the whole list (or merge server data into non-dirty rows).
  4. Expose the dirty count to the parent for TAB-switch guard (DIRECTORY-05).
  5. Add tests for dirty marker and Save disabled state.
- **Acceptance:**
  - Component test: editing a name shows 'Unsaved' on that row only and enables its Save.
  - Component test: saving row A leaves row B's unsaved edits intact.
  - Component test: Save is disabled for unchanged rows.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-ASSIGNMENT-DIRECTORY-07  ·  LOW  ·  confirmed  ·  theme AUTHZ (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Hub shows this tile to every crm_user although the layout silently redirects them to /crm (app/(app)/crm/page.tsx:59).
- **Verified evidence:** crm/page.tsx:59 lists { title: 'Assignment Directory', href: '/crm/assignment-directory' } in the Configuration section for everyone (LinkTiles.tsx has no role filtering); assignment-directory/layout.tsx:14-16 does requireAnyRole(ALLOWED_ROLES, '/crm'), so a crm_user clicking the tile is silently redirected back to /crm with no message. The same applies to Assignment Rules (:58), Agent Workload (:60, currently not even gated, see AGENT-WORKLOAD-01), Escalation Rules, Task Escalation and other admin-only tiles, since 10 sibling layouts gate admin roles.
- **Files to change:** `apps/web/src/app/(app)/crm/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`, `apps/web/src/lib/auth/crmRoles.ts`
- **Fix steps:**
  1. Create lib/auth/crmRoles.ts exporting CRM_ADMIN_ROLES (the list used by the layouts) and reuse it in the layouts and hub.
  2. Add an optional `adminOnly: true` flag to the Configuration tiles (or a separate adminSection) and in the server component Page call getSessionRoles() (roleGuard.ts:32) to filter out those tiles for non-admins.
  3. Optionally redirect with a notice (e.g. /crm?denied=1 toast) instead of a silent redirect.
  4. Add a page test: crm_user sees no 'Assignment Directory' tile; crm_admin does.
- **Acceptance:**
  - Page test with roles ['crm_user']: no tiles pointing at admin-config routes.
  - Page test with roles ['crm_admin']: all Configuration tiles shown.
  - Manual: crm_user cannot navigate by tile to a page that bounces them.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Hiding is UX only; server-side layout guards must remain the enforcement.


---
## /crm/assignment-rules  —  `crm/assignment-rules.html`

- **Source:** `apps/web/src/app/(app)/crm/assignment-rules/page.tsx`
- **Design reference:** `redesign/crm/assignment-rules.html`

### GAP-CRM-ASSIGNMENT-RULES-01  ·  HIGH  ·  confirmed  ·  theme VALIDATION (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Routing rules are a platform-wide, live control edited as free JSON: criteria is any JSON object (only "is an object" is checked), the placeholder shows {"region":"west"}, and there is no per-strategy schema, dry-run or test-a-lead preview before a row is saved and starts routing leads (app/_components/crm/AssignmentRulesEditor.tsx:48, app/_components/crm/AssignmentRulesEditor.tsx:244).
- **Verified evidence:** AssignmentRulesEditor.tsx:48-57 parseCriteria only checks JSON.parse gives a non-array object; :239-246 criteria is a plain <input> with placeholder '{"region":"west"}' (a placeholder, not fabricated data). rowValid (:59) and saveRow (:104-131) POST/PUT straight to v1/crm/assignment-rules with no per-strategy shape check; lib/crm/assignment.ts has no dry-run/preview call (only assignLead runRules on a real lead, :~145). Route is already admin-gated by assignment-rules/layout.tsx (requireAnyRole crm_admin etc.). Theme FABRICATED is wrong: nothing is fabricated.
- **Files to change:** `apps/web/src/app/_components/crm/AssignmentRulesEditor.tsx`, `apps/web/src/lib/crm/assignment.ts`, `apps/web/src/lib/crm/assignmentCriteria.ts`, `apps/web/src/lib/crm/__tests__/assignmentCriteria.test.ts`
- **Fix steps:**
  1. Create lib/crm/assignmentCriteria.ts exporting a zod schema per RuleType in RULE_TYPES (territory, round_robin, score_threshold, product, segment, language, capacity) - get the exact keys from the backend contract (AS-001) before coding; do not invent them.
  2. In AssignmentRulesEditor replace the raw JSON <input> with a textarea plus a per-strategy field group (or keep JSON behind an 'Advanced' toggle) and have parseCriteria/rowValid call schemaFor(row.ruleType).safeParse, showing the zod message under the field via aria-describedby.
  3. Re-validate criteria when ruleType changes (onChange at :231) and block Save/Create when it fails.
  4. Show a one-line plain-language summary of the parsed rule ('Route leads in region west to fallback owner X') beside the row.
  5. Add a 'Test with a lead' control only if backend exposes a dry-run endpoint; otherwise raise it as a backend requirement and ship the schema part alone.
- **Acceptance:**
  - Unit: schemaFor('score_threshold').safeParse({region:'west'}) fails; a valid object passes.
  - Component: entering {"foo":1} on a Territory row shows an inline error and Save does not call browserFetch.
  - Manual: changing strategy re-validates existing criteria text.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Wrong schema would block valid existing rules; load legacy rows leniently and only enforce on edit. Misrouted leads if criteria semantics are misunderstood.
- **Depends on:** GAP-CRM-ASSIGNMENT-RULES-02

### GAP-CRM-ASSIGNMENT-RULES-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was UUID)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Fallback owner is a hand-typed raw id ("owner id"); a typo saves fine and mis-routes fallback leads, and the id is unreadable when reviewing the chain (app/_components/crm/AssignmentRulesEditor.tsx:254).
- **Verified evidence:** AssignmentRulesEditor.tsx:250-256 fallbackOwnerId is a free-text <input placeholder='owner id'>; saveRow only trims it (:118) and rowValid does not require it or check it exists. The id is shown raw in the table. No EntityPicker component exists in apps/web/src or packages/ui-kit (grep found none); only SmartCombobox (string options, recent values) and an admin users loader (_data/loaders.ts:4851 /api/v1/admin/users) exist. Which directory endpoint is right for CRM owners cannot be verified (crm-service absent).
- **Files to change:** `apps/web/src/app/_components/crm/AssignmentRulesEditor.tsx`, `apps/web/src/lib/crm/assignment.ts`, `apps/web/src/app/_components/crm/OwnerPicker.tsx`
- **Fix steps:**
  1. Create a shared client component OwnerPicker (async combobox: search by name, returns {id,name}) built on the accessible pattern in SmartCombobox; back it with the agreed users endpoint via browserFetch.
  2. Use it in AssignmentRulesEditor for fallbackOwnerId, storing id but rendering the resolved name; on load, resolve existing ids to names and show 'Unknown user (id)' if unresolved.
  3. Require a resolved selection in rowValid (or allow empty only if backend treats fallback as optional).
  4. Reuse the same OwnerPicker in LeadAssignmentControl (CONTACTS-DETAIL-01).
- **Acceptance:**
  - Component: typing a name lists matches; selecting sets fallbackOwnerId to the id and shows the name.
  - Typing a non-existent id cannot be saved.
  - Existing rule with a known id renders the person's name.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Picker relies on a user directory endpoint the CRM role may not be allowed to read; wrong choice breaks rule editing. PII: only expose name + id.
- **Depends on:** GAP-CRM-CONTACTS-DETAIL-01

### GAP-CRM-ASSIGNMENT-RULES-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed load the editor shows data [] plus the badge, so the chain reads as empty and "+ Add rule" stays enabled; an admin can build a second chain over one they cannot see (app/_components/crm/AssignmentRulesEditor.tsx:176, lib/crm/assignment.ts:103).
- **Verified evidence:** getAssignmentRules (lib/crm/assignment.ts:100-108) returns {data:[], source:'error'} on non-ok or exception. The editor (:79-85, :168) sets rows=[] and shows only DataSourceBadge; with rows.length===0 (:173-178) it renders the EmptyState 'No assignment rules yet', and '+ Add rule' (:282) stays enabled. Also, after any save/delete load() (:125,:146) is re-run and a failed reload would blank the table in the same way.
- **Files to change:** `apps/web/src/app/_components/crm/AssignmentRulesEditor.tsx`, `apps/web/src/app/_components/ds/ErrorState.tsx`
- **Fix steps:**
  1. In AssignmentRulesEditor branch on source==='error' before the rows.length===0 branch: render ErrorState with toHumanError('load',{area:'assignment rules'}) and a Retry that calls load() (RefreshErrorState uses router.refresh, which does not re-run this client fetch, so use ErrorState with onRetry={() => void load()}).
  2. Hide or disable '+ Add rule' and per-row Save while source==='error'.
  3. In saveRow/confirmDelete, if the follow-up load() returns error keep the previous rows instead of replacing them (return {ok} from load and only setRows on success).
- **Acceptance:**
  - Component: mock getAssignmentRules -> error; expect error state with Retry, no 'No assignment rules yet', Add rule disabled.
  - Retry succeeding shows the table.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; keeps admin from creating a duplicate chain over an unseen one.

### GAP-CRM-ASSIGNMENT-RULES-04  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Order is a free number input per row: duplicates or gaps are accepted and evaluated order for ties is not defined in the UI; reordering means editing numbers and saving each row separately (app/_components/crm/AssignmentRulesEditor.tsx:211).
- **Verified evidence:** Order input :204-213 is type=number min=0; sanitizeInt (:42) only rejects negatives/non-integers, rowValid does not compare across rows, so duplicate or gapped ordinals save. Rows render sorted by ordinal (:193-195, stable sort so ties fall back to load order) but nothing tells the admin how ties are evaluated by the backend (cannot verify: crm-service absent). New rows default ordinal to prev.length (:100), which can collide when gaps exist. Reordering = edit numbers and Save each row (:266). Save of one row calls load() (:125) which also discards other rows' unsaved edits.
- **Files to change:** `apps/web/src/app/_components/crm/AssignmentRulesEditor.tsx`
- **Fix steps:**
  1. Add a cross-row check in the editor: compute duplicate ordinals among current rows and mark the offending inputs aria-invalid with 'Order already used by <name>'; block Save until unique.
  2. Default new-rule ordinal to max(ordinal)+1 instead of prev.length.
  3. Add Move up / Move down buttons per row that swap ordinals and PUT both rows sequentially (or a single reorder call if backend supplies one), disabled while busyKey is set.
  4. Add help text stating the first matching enabled rule by ascending order wins, once backend semantics are confirmed.
- **Acceptance:**
  - Unit: two rows with ordinal 1 flag both inputs invalid and Save is blocked.
  - Click Move up on row 3 swaps ordinals with row 2 and both PUTs succeed.
  - Adding a rule when ordinals are 0,5 gives 6.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Swap done as two PUTs can leave a transient duplicate; prefer a backend reorder endpoint. Misordered chain misroutes new leads.
- **Depends on:** GAP-CRM-ASSIGNMENT-RULES-06

### GAP-CRM-ASSIGNMENT-RULES-05  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Enabling, disabling or deleting a rule changes routing for all new leads immediately, yet only Delete has a confirmation and nothing on the page shows who changed the chain or when (bare PUT/DELETE) (lib/crm/assignment.ts:129).
- **Verified evidence:** Delete does use ConfirmDialog (:285-294). Enable/disable is just a checkbox (:260) that changes local state only; it takes effect when the row's Save is pressed (:266), so 'immediately' is overstated, but Save on an enable change has no confirmation. There is no audit/last-changed display: AssignmentRule (lib/crm/assignment.ts:AssignmentRule) carries no updatedBy/updatedAt and the page never shows one; whether the backend returns them cannot be verified. Audit emission on mutation is a backend concern (CLAUDE.md rule 8), not visible here.
- **Files to change:** `apps/web/src/app/_components/crm/AssignmentRulesEditor.tsx`, `apps/web/src/lib/crm/assignment.ts`
- **Fix steps:**
  1. In saveRow, when the persisted row's enabled flag changes (compare against the loaded value), open ConfirmDialog with 'Turn rule X on/off? New leads will (not) route through it' before PUT.
  2. Extend AssignmentRule and normaliseRule with optional updatedBy/updatedAt only if the API returns them (confirm with backend); render 'Last changed by X on date' in a column.
  3. Otherwise link to the audit log filtered to assignment rules.
- **Acceptance:**
  - Component: toggling enabled then Save opens the dialog; Cancel makes no request.
  - If API returns updatedAt/updatedBy the row shows them.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Extra confirm adds friction but rules are platform-wide. Do not fabricate change history if backend lacks it.
- **Depends on:** GAP-CRM-ASSIGNMENT-RULES-06

### GAP-CRM-ASSIGNMENT-RULES-06  ·  LOW  ·  confirmed  ·  theme STATE (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** No dirty marker per row; unsaved edits are lost on reload and there is no discard or "unsaved changes" cue (app/_components/crm/AssignmentRulesEditor.tsx:93).
- **Verified evidence:** Rows are held in useState (:71) with no baseline copy, so there is no dirty flag per row, no Discard, and no beforeunload guard. Worse, every successful save/delete calls load() (:125,:146) which replaces all rows with server data, silently wiping unsaved edits and unsaved new rows in other rows.
- **Files to change:** `apps/web/src/app/_components/crm/AssignmentRulesEditor.tsx`
- **Fix steps:**
  1. Keep a `saved` snapshot per row (criteriaText, name, ordinal, ruleType, enabled, fallbackOwnerId) in toRow and compute dirty = fields differ.
  2. Show a 'Unsaved' pill and a Discard button on dirty rows; disable Save when not dirty.
  3. Change post-save refresh to merge: replace only the saved row from server data and leave other rows' local edits untouched.
  4. Add a beforeunload listener while any row is dirty.
- **Acceptance:**
  - Component: edit row A, save row B; A's edit is still present and marked Unsaved.
  - Discard restores the loaded values.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /crm/campaigns  —  `crm/campaigns.html`

- **Source:** `apps/web/src/app/(app)/crm/campaigns/page.tsx`
- **Design reference:** `redesign/crm/campaigns.html`

### GAP-CRM-CAMPAIGNS-01  ·  HIGH  ·  partly  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Campaigns are identified only by campaignId: the first column, the row link label and the detail subtitle print the raw id (a UUID), so a marketing officer cannot tell which campaign is which; the summary row type carries no name (app/(app)/crm/campaigns/CampaignRoiTable.tsx:42, app/(app)/crm/campaigns/[id]/page.tsx:50).
- **Verified evidence:** Confirmed for the UI: CampaignRoiTable.tsx:42/85 column 'Campaign' shows row.campaignId, rowHref (:105) links by id, and detail subtitle (:50) prints the id; CampaignRow has no name. Not verifiable: whether CRMCampaignRoiSummaryRow (@civitasone/types, absent) or the API can supply a name, so 'the summary row type carries no name' cannot be checked.
- **Files to change:** `apps/web/src/app/(app)/crm/campaigns/CampaignRoiTable.tsx`, `apps/web/src/app/(app)/crm/campaigns/page.tsx`, `apps/web/src/app/(app)/crm/campaigns/[id]/page.tsx`, `packages/types (crmCampaignRoiSummarySchema)`
- **Fix steps:**
  1. Ask backend to include campaignName on roi-summary and roi endpoints (or provide a campaign lookup) and add it to the zod schemas.
  2. Add `name` to CampaignRow and render it as the first column with the id as a small secondary line; make filterPlaceholder 'Filter by campaign name'.
  3. Use the name in exportFilename rows and in the detail title (DETAIL-01).
- **Acceptance:**
  - Table test: name shown, id not the primary text.
  - Filter by name matches rows.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-CAMPAIGNS-DETAIL-01

### GAP-CRM-CAMPAIGNS-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed load the badge appears but Campaigns Tracked shows 0 and Total Spend / Attributed Revenue show ₹0.00 (unlike Accounts and Activities, which use "—"), and the table says "No campaign spend recorded" — an outage reads as "nothing spent" (app/(app)/crm/campaigns/page.tsx:32).
- **Verified evidence:** campaigns/page.tsx:11-13 always folds campaigns (=[] on error) so totals.campaigns=0, costMinor '0', revenueMinor '0'; :32-34 render '0' and formatMoney('0') = '₹0.00' (only ROI becomes '—' because cost===0). The table (CampaignRoiTable emptyTitle :112) says 'No campaign spend recorded'. The error only adds the DataSourceBadge (:30). Status is not read.
- **Files to change:** `apps/web/src/app/(app)/crm/campaigns/page.tsx`, `apps/web/src/app/(app)/crm/campaigns/CampaignRoiTable.tsx`
- **Fix steps:**
  1. Read `status`/`errorMessage` from getCrmCampaignRoiSummary.
  2. When source==='error' render <LoadErrorState result={{status,errorMessage}} area='campaign performance' backHref='/crm' /> instead of the StatGrid and table (or at minimum pass '—' to each StatCard).
  3. Keep the zero/empty rendering only for source==='api'.
- **Acceptance:**
  - Page test: mocked error -> no '₹0.00', no 'No campaign spend recorded', retry visible.
  - Mock success with [] -> '0' and ₹0.00 with empty table.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-CONTACTS-DETAIL-05

### GAP-CRM-CAMPAIGNS-03  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The summary is fetched with a hard limit=200 and totals are folded from whatever returns; beyond 200 campaigns Total Spend, Revenue and Portfolio ROI are silently partial with no "showing 200" cue (app/_data/loaders.ts:3128).
- **Verified evidence:** loaders.ts:3128 fetches roi-summary?limit=200; the page (:11-13) sums whatever returns via portfolioTotals and prints 'Campaigns Tracked' = rows.length. Nothing indicates truncation. Whether the response carries a total/next cursor cannot be verified (schema in absent @civitasone/types).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/crm/campaigns/page.tsx`, `apps/web/src/app/(app)/crm/campaigns/campaigns.ts`
- **Fix steps:**
  1. Check with backend whether roi-summary returns total or supports offset; add `total` to crmCampaignRoiSummarySchema.
  2. Have getCrmCampaignRoiSummary return {rows,total} (or page through until exhausted) and pass a `truncated` flag to the page.
  3. When truncated show a banner 'Showing first 200 of N campaigns - totals are partial' and label the StatCards accordingly; preferably ask backend for server-side portfolio totals.
- **Acceptance:**
  - Unit: 200 rows with total 350 renders the partial banner.
  - Under 200 rows shows no banner.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Finance-facing totals under-reported silently for large tenants.

### GAP-CRM-CAMPAIGNS-04  ·  MEDIUM  ·  confirmed  ·  theme MONEY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** portfolioTotals adds revenue from campaigns with no spend recorded ("No spend recorded" rows) into the numerator but they add nothing to cost, which lifts Portfolio ROI above what measured campaigns earned (app/(app)/crm/campaigns/campaigns.ts:45).
- **Verified evidence:** portfolioTotals (campaigns.ts:39-56) sums costMinor and revenueMinor over all rows including rows roiVerdict flags 'unmeasured' (cost 0, :66-68); their revenue enters the numerator of ROI ((revenue-cost)*10000/cost, :54) with no cost, inflating Portfolio ROI. Page (campaigns/page.tsx:17-20) then displays it. Line cited (:45) is the cost accumulation; the ROI is at :54.
- **Files to change:** `apps/web/src/app/(app)/crm/campaigns/campaigns.ts`, `apps/web/src/app/(app)/crm/campaigns/page.tsx`, `apps/web/src/app/(app)/crm/campaigns/__tests__/campaigns.test.ts`
- **Fix steps:**
  1. In portfolioTotals compute roiBasisPoints from measured rows only (costMinor>0n): sum measuredCost and measuredRevenue separately.
  2. Keep Total Spend / Attributed Revenue showing all rows but add unmeasuredRevenueMinor and count to PortfolioTotals.
  3. On the page show a note 'ROI excludes N campaigns with no spend recorded (₹X revenue)'.
- **Acceptance:**
  - Unit: rows [{cost 100, rev 200},{cost 0, rev 500}] -> roiBasisPoints 10000 (100%), not 60000.
  - All-unmeasured -> null ('—').
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Changes a headline number finance/marketing may have quoted; note in release notes.

### GAP-CRM-CAMPAIGNS-05  ·  LOW  ·  partly  ·  theme EXPORT (was PII)

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-08 #2012 (export is permission-gated and fail-closed audited): closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Table offers CSV export of spend and revenue with no note that the file leaves the tenant boundary or is logged (exportable=true) (app/(app)/crm/campaigns/CampaignRoiTable.tsx:66).
- **Verified evidence:** exportable is set (CampaignRoiTable.tsx:109; detail page :93). DataTable.downloadCsv (ds/DataTable.tsx:~275-290) builds a Blob client-side and downloads it: no notice, no audit call, nothing logged. The data is campaign spend/revenue aggregates, not personal data, so PII tag is overstated; the real gap is no export notice/audit for a finance-sensitive file.
- **Files to change:** `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/app/(app)/crm/campaigns/CampaignRoiTable.tsx`, `apps/web/src/app/(app)/crm/campaigns/[id]/page.tsx`
- **Fix steps:**
  1. Add optional DataTable prop exportNotice (string) shown as a title/helper next to the CSV button, and pass 'Exports leave the system; handle per policy' where the policy wants it.
  2. Optionally add onExport callback prop that posts an audit event via a BFF route (decision needed: server-side audit for client exports).
- **Acceptance:**
  - Component: button has the notice text when prop set.
  - onExport fires once per click.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; policy decision on whether client CSV exports must be audited.


---
## /crm/campaigns/[id]  —  `crm/campaigns-detail.html`

- **Source:** `apps/web/src/app/(app)/crm/campaigns/[id]/page.tsx`
- **Design reference:** `redesign/crm/campaigns-detail.html`

### GAP-CRM-CAMPAIGNS-DETAIL-01  ·  MEDIUM  ·  confirmed  ·  theme UUID (was WIRING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The only identity of the campaign is the raw campaignId in the subtitle ("Campaign 7f3a1c2e-… · INR"); the title is the generic "Campaign Performance", identical to the list page (app/(app)/crm/campaigns/[id]/page.tsx:50).
- **Verified evidence:** app/(app)/crm/campaigns/[id]/page.tsx:48-53 title is the constant 'Campaign Performance' (same as campaigns/page.tsx:25) and subtitle prints `Campaign ${campaign.campaignId} · ${campaign.currency}`. Whether the API supplies a campaign name cannot be verified: the schema crmCampaignRoiSchema lives in @civitasone/types, absent from the snapshot.
- **Files to change:** `apps/web/src/app/(app)/crm/campaigns/[id]/page.tsx`, `packages/types (crmCampaignRoiSchema, backend response)`
- **Fix steps:**
  1. Confirm with backend whether /api/v1/crm/campaigns/:id/roi (and roi-summary) can return campaignName; add it to the zod schema.
  2. In page.tsx set title={campaign.campaignName ?? 'Campaign'} and subtitle to short id + currency, and set generateMetadata with the name.
  3. If no name is available, show a truncated id with a copy button rather than the full UUID.
- **Acceptance:**
  - Render test: with campaignName='Diwali Push' the h1 is 'Diwali Push' and the id is only secondary.
  - Missing name falls back to 'Campaign' + short id.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-CAMPAIGNS-01

### GAP-CRM-CAMPAIGNS-DETAIL-02  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** A fetch failure and a campaign with no figures both render EmptyState "No performance recorded — This campaign has no cost, revenue or response figures…"; only a small badge distinguishes an outage from a true empty (app/(app)/crm/campaigns/[id]/page.tsx:22).
- **Verified evidence:** Loader getCrmCampaignRoi (loaders.ts:3141) returns data null with source:'error' and status for every non-ok response, including the 404 the comment calls 'expected' (apiClient.ts fetchJson: !response.ok -> source:'error', status). page.tsx:22-33 shows the badge when source==='error' and the same EmptyState in every null case, so an outage and a true 'no figures' 404 look identical (both get the badge, and the page never reads `status`). So the finding's premise that the badge distinguishes them is wrong: it appears in both.
- **Files to change:** `apps/web/src/app/(app)/crm/campaigns/[id]/page.tsx`, `apps/web/src/app/_components/ds/LoadErrorState.tsx`
- **Fix steps:**
  1. Destructure `status`/`errorMessage` from getCrmCampaignRoi.
  2. If status===404 render the current EmptyState (no badge); otherwise render <LoadErrorState result={{status,errorMessage}} area='campaign performance' backHref='/crm/campaigns' /> (already handles 403 and retry).
  3. Keep DataSourceBadge only for the success-with-fallback case (or drop it here).
- **Acceptance:**
  - Test: loader mock status 404 -> EmptyState 'No performance recorded'.
  - Mock status 500 -> LoadErrorState with Retry and no 'no figures' copy.
  - Mock 403 -> PermissionDenied.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-CONTACTS-DETAIL-05

### GAP-CRM-CAMPAIGNS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The subtitle prints campaign.currency (e.g. "INR") but every amount goes through formatMoney, which always prints ₹, so a non-INR campaign would show rupee symbols on foreign amounts (app/(app)/crm/campaigns/[id]/page.tsx:50, lib/formatters.ts:55).
- **Verified evidence:** formatMoney(minorUnits) in lib/formatters.ts:~66-131 takes no currency and hard-codes '₹' (:131). The page prints campaign.currency in the subtitle (:50) but formats Spend/Revenue/Net and the amount cells (cellType 'amount') and cost-per-response through formatMoney, so a non-INR campaign would show rupee symbols. Whether non-INR campaigns exist cannot be verified (crm-service absent); CLAUDE.md rule 11 says money carries an ISO 4217 code.
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/crm/campaigns/[id]/page.tsx`, `apps/web/src/app/(app)/crm/campaigns/page.tsx`, `apps/web/src/app/(app)/crm/campaigns/CampaignRoiTable.tsx`
- **Fix steps:**
  1. Add formatMoneyIn(minor, currency) (Intl.NumberFormat with currency, minor exponent from the currency) next to formatMoney, keeping formatMoney as INR shortcut.
  2. On the detail page use it for the four StatCards and cost-per-response; for the DataTable amount cells use render columns rather than cellType 'amount'.
  3. On the list page, if rows have mixed currencies, do not sum them: group per currency or show '—' with a note.
- **Acceptance:**
  - Unit: formatMoneyIn('12345','USD') -> '$123.45'; 'INR' output equals formatMoney.
  - Page test: currency USD shows no ₹.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money display; summary row may not carry currency so list totals could sum mixed currencies (check the schema).
- **Depends on:** GAP-CRM-CAMPAIGNS-04

### GAP-CRM-CAMPAIGNS-DETAIL-04  ·  LOW  ·  confirmed  ·  theme DEADEND (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W1 SF-14a re-confirmed against main d0b65c3b5 (feature still present after the Field/Input conversion): closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Detail is read-only: there is no way to post a period's cost or revenue from here although the empty period state tells the user to "Post a reporting period's cost and revenue" (app/(app)/crm/campaigns/[id]/page.tsx:97).
- **Verified evidence:** Detail page is read-only (no forms/actions); the DataTable emptyMessage (:97) says 'Post a reporting period's cost and revenue to see the breakdown.' and no page, component or lib helper in apps/web posts campaign periods (grep of web for campaign period/roi writes found only the two loaders). Whether a POST endpoint exists in crm-service cannot be verified. Note the empty state is also unreachable in practice: a campaign with zero periods returns 404 and shows the page-level EmptyState instead.
- **Files to change:** `apps/web/src/app/(app)/crm/campaigns/[id]/page.tsx`, `apps/web/src/lib/crm/campaignPeriods.ts`, `apps/web/src/app/(app)/crm/campaigns/[id]/PostPeriodForm.tsx`
- **Fix steps:**
  1. Decide with backend whether period posting is in scope and get the endpoint contract.
  2. If yes: add PostPeriodForm (periodStart, periodEnd, cost and revenue in rupees converted with rupeesToMinorString from lib/money.ts, responses), zod-validated, calling a new lib/crm/campaignPeriods.ts postPeriod(); router.refresh() on success.
  3. If no: reword both empty-state messages to say figures are posted by the finance/marketing integration and remove the imperative.
- **Acceptance:**
  - Form test: cost '1500.50' sends costMinor '150050'.
  - If out of scope, the empty state contains no instruction to post.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Writes money data; needs role gating and audit on backend.


---
## /crm/contacts  —  `crm/contacts.html`

- **Source:** `apps/web/src/app/(app)/crm/contacts/page.tsx`
- **Design reference:** `redesign/crm/contacts.html`

### GAP-CRM-CONTACTS-01  ·  HIGH  ·  partly  ·  theme PII/EXPORT (was PII)

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-08 #2012 (export is permission-gated and fail-closed audited): closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Export downloads every contact (name, phone, email) as a JSON file from a bare ghost button visible to all CRM roles: no ConfirmDialog, purpose or reason, it ignores the active filters, and nothing on the page shows the export is logged (app/(app)/crm/contacts/ContactToolbar.tsx:26).
- **Verified evidence:** ContactToolbar.tsx:22-40, 60: ghost 'Export' button, no role check or dialog, calls browserFetch('v1/crm/contacts/export') without query params (l.26) so page filters are ignored, then downloads body.data as JSON. Shown to whoever sees the page. Fields exported and whether the backend audits/role-gates the export cannot be verified (crm-service absent).
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/ContactToolbar.tsx`, `apps/web/src/app/(app)/crm/contacts/page.tsx`
- **Fix steps:**
  1. Wrap export in the ds ConfirmDialog with a mandatory purpose field and a note that the export is logged.
  2. Hide/disable the button unless the user's permission includes crm.contacts.export (use existing PermissionDenied/permission helper).
  3. Pass current search/filter params to the export URL, or label it 'Export all contacts'.
  4. Send purpose to backend (needs param) so the audit event records it; offer CSV, not raw JSON.
- **Acceptance:**
  - Non-privileged role: button absent.
  - Privileged role: dialog requires purpose; request carries it; filtered view exports only filtered rows.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII bulk egress; backend audit event must exist (CLAUDE.md rule 8) - unverified.

### GAP-CRM-CONTACTS-02  ·  HIGH  ·  partly  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Phone and Email are printed in full in an 11-column list for every role while the banner promises "Access is role-scoped and logged"; there is no masking or reveal step for personal data under DPDP (app/(app)/crm/contacts/ContactsTable.tsx:50, app/(app)/crm/contacts/page.tsx:63).
- **Verified evidence:** ContactsTable.tsx:50 phone and :52-ish email columns print c.phone/c.email in full for all users (l.116-118 mapping); page.tsx:63 banner says 'Access is role-scoped and logged'. No <Masked> component exists in apps/web (grep). Role-scoping/logging by backend cannot be verified. The 11 columns claim is true.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/ContactsTable.tsx`, `apps/web/src/app/_components/ds/Masked.tsx`, `apps/web/src/app/(app)/crm/contacts/page.tsx`
- **Fix steps:**
  1. Create ds/Masked.tsx: shows 98xxxxx210 / a***@d***.com, with a 'Reveal' button for permitted roles that calls a reveal endpoint (audit) and re-masks after ~30s.
  2. Use it for phone and email cells in ContactsTable and the merge options labels in page.tsx:203.
  3. Until a reveal endpoint exists, mask by default for roles lacking crm.pii.read.
  4. Reword the banner if reveal is not logged.
- **Acceptance:**
  - Default render shows masked phone/email.
  - Reveal by permitted role triggers one audit call and shows plain value; other roles have no reveal control.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** PII exposure under DPDP; reveal flow depends on backend audit endpoint and role claims.
- **Depends on:** GAP-CRM-CONTACTS-01

### GAP-CRM-CONTACTS-03  ·  MEDIUM  ·  confirmed  ·  theme LABELS (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The column labelled "Priority Level" renders c.temperature (hot/warm/cold) and sits next to "Priority" (high/medium/low); the two headers read as the same thing (app/(app)/crm/contacts/ContactsTable.tsx:76).
- **Verified evidence:** ContactsTable.tsx:76 `{ key: 'temperature', label: 'Priority Level' }` next to l.77 `{ key: 'priority', label: 'Priority' }`. Data: temperature = hot/warm/cold.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/ContactsTable.tsx`
- **Fix steps:**
  1. Rename temperature column to 'Temperature' (matches LeadFilters filter name) or 'Lead Warmth'.
  2. Optionally render as StatusPill with tone hot/warm/cold plus text (not colour alone).
- **Acceptance:**
  - Headers read 'Temperature' and 'Priority'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-CONTACTS-04  ·  MEDIUM  ·  confirmed  ·  theme FILTER-STATE (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Toolbar search box and segment select start empty (useState("")) and are never seeded from the URL, so after a search the results are filtered while the box is blank; pressing Search or Apply filters also drops the other control's parameters because each pushes only its own query (app/(app)/crm/contacts/ContactToolbar.tsx:10, app/(app)/crm/contacts/ContactToolbar.tsx:19).
- **Verified evidence:** ContactToolbar.tsx:10-11 useState('') / 'all', not read from searchParams; applyFilters (l.15-20) pushes only search+segment, dropping segmentName/temperature/priority/etc. LeadFilters.tsx:46-56 likewise builds params only from its own state and drops search/segment. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/ContactToolbar.tsx`, `apps/web/src/app/_components/crm/LeadFilters.tsx`, `apps/web/src/app/(app)/crm/contacts/page.tsx`
- **Fix steps:**
  1. Pass searchParams (search, segment, and the classification filters) from page.tsx to ContactToolbar as initial props and seed the state.
  2. In applyFilters and in LeadFilters, start from useSearchParams() copy, set/delete only own keys, then push.
  3. Add a 'Clear filters' control.
  4. Consider making inputs uncontrolled with key=searchParams so back/forward resets them.
- **Acceptance:**
  - Search 'sharma', then apply Priority=high: both remain in URL and both controls show values.
  - Reload keeps box populated.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-CONTACTS-07

### GAP-CRM-CONTACTS-05  ·  MEDIUM  ·  confirmed  ·  theme EMPTY-STATE (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Empty copy "No contacts yet — Add your first contact to get started" is shown when a search or filter matches nothing, telling the user the master is empty; it also has no action (app/(app)/crm/contacts/ContactsTable.tsx:68).
- **Verified evidence:** ContactsTable.tsx:68 (EmptyState 'No contacts yet' / 'Add your first contact to get started.') renders whenever tableRows.length===0, including when the server filtered by search/filters (page.tsx passes them to the loader); no action prop. source==='error' is handled elsewhere (badge). Copy is hard-coded (next-intl theme is generic).
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/ContactsTable.tsx`, `apps/web/src/app/(app)/crm/contacts/page.tsx`
- **Fix steps:**
  1. Pass `filtered: boolean` (any search param set) from page.tsx to ContactsTable.
  2. If filtered: title 'No matching contacts', message 'Try changing or clearing the filters', action link to /crm/contacts.
  3. Else keep the empty-master copy with a '+ New Contact' action link.
  4. If source==='error' show RefreshErrorState rather than empty.
- **Acceptance:**
  - Search 'zzz' shows 'No matching contacts' with clear link.
  - Empty tenant shows Add action.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-CONTACTS-04

### GAP-CRM-CONTACTS-06  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Lead Status prints the raw enum (new, qualified, unqualified); the New Contact form relabels the same values as "Engaged Stakeholder" and "Inactive Stakeholder", so one status has two names across the module (app/(app)/crm/contacts/ContactsTable.tsx:52, app/(app)/crm/contacts/new/page.tsx:291).
- **Verified evidence:** ContactsTable.tsx:52 prints c.leadStatus raw ('qualified'); new/page.tsx:291-292 labels the same values 'Engaged Stakeholder'/'Inactive Stakeholder'; edit form capitalises. See NEW-05.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/ContactsTable.tsx`, `apps/web/src/lib/crm/leadQualification.ts`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Use the shared LEAD_STATUS_LABELS map (see NEW-05) in the table via StatusPill with label.
  2. Add tones for all statuses incl. disqualified.
  3. Use humanizeStatus (lib/formatters.ts:44) as fallback.
- **Acceptance:**
  - Table shows 'Qualified' (or agreed label) identical to form.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CRM-CONTACTS-NEW-05

### GAP-CRM-CONTACTS-07  ·  LOW  ·  confirmed  ·  theme LABELS (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Two separate filter mechanisms (toolbar segment "mine/recent" and classification segment) share the word "segment"; the page itself needs a comment to keep them apart (app/(app)/crm/contacts/page.tsx:11).
- **Verified evidence:** page.tsx:11-12 defines both `segment` (view mode mine/recent, sent to backend as `segment` in loaders.ts:1401) and `segmentName` (classification), with a comment to tell them apart. The URL/backend key `segment` cannot be renamed without backend change.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/page.tsx`, `apps/web/src/app/(app)/crm/contacts/ContactToolbar.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Relabel the toolbar select 'View' (All / Mine / Recent) and the aria-label 'Filter contacts by view'.
  2. Optionally rename UI query key to `view` and map to backend `segment` in getCrmContacts (keep old key accepted).
- **Acceptance:**
  - Toolbar select reads 'View'; filters still work.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Bookmarked URLs using ?segment= must keep working.
- **Depends on:** GAP-CRM-CONTACTS-04

### GAP-CRM-CONTACTS-08  ·  LOW  ·  partly  ·  theme RESPONSIVE (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Eleven columns in one table is heavy on a phone; rows without an id get an empty rowHref ("") and cannot be opened (app/(app)/crm/contacts/ContactsTable.tsx:85).
- **Verified evidence:** ContactsTable.tsx:138-149 defines 11 columns (true); DataTable wraps in .tbl-wrap (DataTable.tsx:322, scrolls horizontally). rowHref returns '' when no id (l.85), but DataTable.resolveHref (l.211) returns '' which is falsy at l.362-375, so the row simply is not clickable; no error. PII theme is wrong.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/ContactsTable.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Return undefined instead of '' from rowHref for id-less rows (type allows string only: adjust to `string | undefined`).
  2. Add column visibility: hide segment, tags, expectedValue on <640px via a `hideOnMobile` column flag or card layout.
  3. Confirm every listed contact has id (mapper) or log.
- **Acceptance:**
  - At 375px width the table shows name, phone, status, and expands or scrolls sensibly.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /crm/contacts/[id]  —  `crm/contacts-detail.html`

- **Source:** `apps/web/src/app/(app)/crm/contacts/[id]/page.tsx`
- **Design reference:** `redesign/crm/contacts-detail.html`

### GAP-CRM-CONTACTS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme UUID (was CONFIRM)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Assign and Transfer ownership ask for a hand-typed "owner id" with placeholder "owner id"; a mistyped or copied UUID reassigns a lead to nobody or the wrong person, and the confirm dialog cannot show a name (app/_components/crm/LeadAssignmentControl.tsx:131).
- **Verified evidence:** LeadAssignmentControl.tsx:127-135 (assign) and :167-175 (transfer) are free-text inputs with placeholder 'owner id'; beginAssign/beginTransfer (:36-54) only check non-empty; dialog titles interpolate the raw typed id (:97,:109) and success messages too (:68,:82). Nothing validates the id exists.
- **Files to change:** `apps/web/src/app/_components/crm/LeadAssignmentControl.tsx`, `apps/web/src/app/_components/crm/OwnerPicker.tsx`, `apps/web/src/lib/crm/assignment.ts`
- **Fix steps:**
  1. Create/reuse shared OwnerPicker (see ASSIGNMENT-RULES-02) returning {id,name}.
  2. Replace both inputs with OwnerPicker; store the selected object, send ownerId only from a selection.
  3. Use the person's name in dialog titles, descriptions and success messages.
  4. Keep 'Run rules' mode unchanged.
- **Acceptance:**
  - Component: cannot submit without a selection; dialog title shows the selected name.
  - Assign call body contains the selected id.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Lead ownership/routing; needs the right user-directory endpoint and permissions.
- **Depends on:** GAP-CRM-ASSIGNMENT-RULES-02

### GAP-CRM-CONTACTS-DETAIL-02  ·  HIGH  ·  partly  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Phone, Email and Marketing Consent are printed in full to every role; consent is shown as bare Yes/No with no purpose, date or source, which DPDP consent records need, and there is no masked-until-revealed step (app/(app)/crm/contacts/[id]/page.tsx:58).
- **Verified evidence:** Detail page prints phone and email (page.tsx:58-59) and Marketing Consent as Yes/No (:64-66) to every role that passes the CRM layout (crm_user, crm_admin, platform_admin, super_admin) with no masking; no mask helper exists in apps/web (grep). Overstated: the Customer360Panel on the same page shows consent with the updatedAt date (:165-178), but still no purpose/source, and the page's own Yes/No duplicates it.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/[id]/page.tsx`, `apps/web/src/app/_components/Masked.tsx`
- **Fix steps:**
  1. Decide the masking policy per role with the privacy owner (who may see full phone/email).
  2. Create <Masked value type='phone'|'email' canReveal> that shows 98XXXXX210 style and reveals on click (with audit call if required); compute canReveal server-side in page.tsx from getSessionRoles().
  3. Remove the Yes/No consent row and rely on the Customer360 consent block, extended with purpose/source once available.
- **Acceptance:**
  - Component: without reveal permission the phone is masked and no full value is in the DOM.
  - Reveal click shows full value and is logged (if required).
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** PII exposure and DPDP; server must not send the full value if the role cannot reveal it (masking only in UI is cosmetic).
- **Depends on:** GAP-CRM-CONTACTS-DETAIL-EDIT-07

### GAP-CRM-CONTACTS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W1 SF-14a re-confirmed against main d0b65c3b5 (feature still present after the Field/Input conversion): closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Log Activity, Edit and Delete render for every CRM role with no canDelete/role check; a normal crm_user gets a Delete control whose success or 403 is only learned after the reason dialog (app/(app)/crm/contacts/[id]/ContactDetailActions.tsx:74).
- **Verified evidence:** ContactDetailActions.tsx renders Log Activity, Edit and Delete (:211-231) unconditionally; the CRM layout (crm/layout.tsx) admits crm_user etc. and page.tsx passes no role info. Delete uses ActionButton requireReason so a denied user learns about a 403 only after typing a reason. lib/auth/roleGuard.ts getSessionRoles() (server-only) is available. Which roles the backend allows to edit/delete cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/[id]/ContactDetailActions.tsx`, `apps/web/src/app/(app)/crm/contacts/[id]/page.tsx`
- **Fix steps:**
  1. Agree the delete/edit role list with backend policy (e.g. crm_admin only for Delete).
  2. In page.tsx (server) call getSessionRoles() and pass canEdit/canDelete props to ContactDetailActions.
  3. Render Edit/Delete only when allowed (or disabled with a title explaining why); keep server enforcement as the authority.
- **Acceptance:**
  - Component: canDelete=false hides Delete.
  - Manual: crm_user session sees no Delete.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** UI hiding is not security; backend must still 403.

### GAP-CRM-CONTACTS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme DUPLICATION (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The same facts appear twice: page-level Related Deals and Activity Timeline cards duplicate the Deals and Next actions inside Customer360Panel and the Activity & follow-up panel, so the screen can show two versions of one deal list (app/(app)/crm/contacts/[id]/page.tsx:93, app/_components/crm/Customer360Panel.tsx:200).
- **Verified evidence:** page.tsx:91-110 'Related Deals' (from contact.deals) and :125-139 'Activity Timeline' (contact.activityTimeline) are rendered in addition to Customer360Panel (Deals :197-215, Next actions :181-195, at :83) and ActivityFeed (:84). Two data sources (contact detail payload vs 360 aggregate) can disagree. Theme VALIDATION is wrong.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/[id]/page.tsx`, `apps/web/src/app/_components/crm/Customer360Panel.tsx`
- **Fix steps:**
  1. Remove the page-level Related Deals card and the Activity Timeline card (or the equivalent block inside Customer360Panel), keeping the one that is richer and links to /crm/deals/{id}.
  2. If contact.deals is dropped from use, stop requesting it in ContactDetailSchema when convenient.
  3. Ensure the retained panel handles error/empty states.
- **Acceptance:**
  - Page test: a deal appears once.
  - Layout snapshot has no duplicate 'Deals' heading.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-CONTACTS-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** A failed fetch and a deleted/missing contact render the same "Contact not found — does not exist or has been removed" with only a small badge to tell an outage apart (app/(app)/crm/contacts/[id]/page.tsx:27).
- **Verified evidence:** page.tsx:22-29 shows 'Contact not found - This contact does not exist or has been removed.' for any null; the badge is added when source==='error' (:26). But fetchJson returns source:'error' for a real 404 too, so the badge does not distinguish outage from missing; `status` is ignored.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/[id]/page.tsx`, `apps/web/src/app/_components/ds/LoadErrorState.tsx`
- **Fix steps:**
  1. Destructure status/errorMessage from getContactById.
  2. status===404 -> keep EmptyState (no badge); else <LoadErrorState result={{status,errorMessage}} area='contact' backHref='/crm/contacts' />.
- **Acceptance:**
  - Test: status 500 -> retry state, not 'does not exist'.
  - 404 -> not found copy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-CONTACTS-DETAIL-06  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 closed by #1860, verified on main 9c5e9e9e9; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** Ten client panels each fetch separately after the server render, so the page paints its top card and then fills in over many spinners; loading.tsx shows two blocks and no columns (app/(app)/crm/contacts/[id]/loading.tsx:7).
- **Verified evidence:** Eleven client components fetch in useEffect after the server render (QualifyPanel, Customer360Panel, ActivityFeed, CommunicationLog, AddressesEditor, ContactRolesEditor, DocumentAlertsView, DocumentsPanel, LeadTransitionControl, AssignmentLogView, ScoreHistoryView), each with its own loading state. contacts/[id]/loading.tsx has header bars and two card blocks (h-48, h-40) in a single column and uses Tailwind min-h-screen bg-slate-50 unlike the two-column g-main layout.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/[id]/loading.tsx`, `apps/web/src/app/(app)/crm/contacts/[id]/page.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx to mirror the real layout: header, .grid.g-main with a left column of 4-5 card skeletons and a right column of 2-3.
  2. Give each panel a consistent skeleton (shared PanelSkeleton) instead of plain 'Loading…' text.
  3. Optional: lazy-load below-the-fold panels (DocumentsPanel, CommunicationLog) on intersection.
- **Acceptance:**
  - Visual: loading state has two columns matching the loaded page.
  - No layout shift greater than a card height when panels resolve.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-CONTACTS-DETAIL-07  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Stage text is the enum with underscores replaced ("prospecting", "closed won") and Lead Status prints raw values, unlike the form labels (app/(app)/crm/contacts/[id]/page.tsx:103).
- **Verified evidence:** page.tsx:103 uses deal.stage.replace(/_/g,' ') giving lower-case 'closed won' into a status pill (cellType 'status'); :61 prints contact.leadStatus raw ('new', 'disqualified'); classification pills (:75) print raw temperature/priority. formatters.ts has humanizeStatus (:~41) that title-cases underscored values, and the edit form capitalises status labels (EditContactForm.tsx:222).
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Use humanizeStatus() for stage, leadStatus, temperature and priority in page.tsx.
  2. Better: export shared LEAD_STATUS_LABELS/DEAL_STAGE_LABELS maps from lib/crm so list, detail and forms agree.
  3. Check StatusPill keying still matches after the label change (pass raw key for colour, humanized text for label).
- **Acceptance:**
  - Unit: humanizeStatus('closed_won') = 'Closed Won'.
  - Detail page shows 'Disqualified' not 'disqualified'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; StatusPill colour mapping may depend on the raw string.


---
## /crm/contacts/[id]/edit  —  `crm/contacts-detail-edit.html`

- **Source:** `apps/web/src/app/(app)/crm/contacts/[id]/edit/page.tsx`
- **Design reference:** `redesign/crm/contacts-detail-edit.html`

### GAP-CRM-CONTACTS-DETAIL-EDIT-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Core fields are sent as `value || undefined`, which JSON.stringify drops, so clearing Email, Phone, Organisation, Designation or City in the form silently leaves the stored value unchanged; the classification patch correctly sends null, so the two halves of one form disagree, and a data-correction/erasure request under DPDP cannot be done here (app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx:125, app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx:98).
- **Verified evidence:** EditContactForm.tsx:161-165 sends email/phone/company/designation/city as `form.x || undefined`; JSON.stringify omits undefined keys, so emptying a field leaves the stored value unchanged. Classification patch uses `|| null` (:134-139) and documents null=clear (:117-121). Whether the contact PATCH accepts null to clear cannot be verified (crm-service absent). Also leadStatus and marketingConsent are always sent.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx`, `apps/web/src/lib/crm/contactPatch.ts`, `apps/web/src/lib/crm/__tests__/contactPatch.test.ts`
- **Fix steps:**
  1. Create buildContactPatch(initial, form) returning only changed fields, mapping trimmed-empty strings to null for clearable fields (email, phone, company, designation, city).
  2. Confirm with backend that PATCH /v1/crm/contacts/:id accepts null as clear (and its zod schema allows nullable); fix backend if not.
  3. Use buildContactPatch in submit() and skip the request if the patch is empty.
  4. After save, verify by router.refresh and show the cleared field as empty.
- **Acceptance:**
  - Unit: initial email 'a@b.c', form email '' -> patch {email:null}.
  - Unchanged form -> empty patch, no PATCH sent.
  - Manual: clear City, save, reload: City is blank.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** PII correction/erasure path (DPDP); wrong null handling in backend could reject the whole PATCH.
- **Depends on:** GAP-CRM-CONTACTS-DETAIL-EDIT-02

### GAP-CRM-CONTACTS-DETAIL-EDIT-02  ·  HIGH  ·  confirmed  ·  theme GOVERNANCE (was CONFIRM)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The Lead status select here can set any status, including disqualified, with no Reason code, note or ConfirmDialog; the contact page's "Change lead status" control requires a reason and audit note, so editing bypasses that governance (app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx:183 vs app/_components/crm/LeadTransitionControl.tsx:174).
- **Verified evidence:** EditContactForm.tsx:219-224 offers all six LEAD_STATUSES (leadQualification.ts:18-25) and sends leadStatus on every PATCH (:166), with no reason, note or ConfirmDialog. LeadTransitionControl (used on the detail page, page.tsx:113) restricts targets via TRANSITIONS (:23-30), requires a reason code or note (:75-86) and confirms (:191-200), and states changes are audited. Whether the backend PATCH enforces the same transition rules cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx`, `apps/web/src/app/(app)/crm/contacts/[id]/edit/page.tsx`
- **Fix steps:**
  1. Remove the Lead status select from EditContactForm and stop sending leadStatus in the PATCH body.
  2. Show current status as read-only text with a link 'Change status' to /crm/contacts/{id} (LeadTransitionControl).
  3. Backend: reject leadStatus changes on the generic PATCH or route them through the transition command with audit.
- **Acceptance:**
  - Component: edit form has no lead status select and PATCH body has no leadStatus.
  - Manual: changing status is only possible via Change lead status with reason.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Governance bypass today (disqualify without reason); removing the field is low risk.
- **Depends on:** GAP-CRM-CONTACTS-DETAIL-EDIT-01

### GAP-CRM-CONTACTS-DETAIL-EDIT-03  ·  MEDIUM  ·  confirmed  ·  theme PARTIAL (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Saving is two sequential calls (contact PATCH, then classification); if the second fails the user sees "Could not update the contact." although the first already persisted, and retrying resends everything (app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx:136).
- **Verified evidence:** submit() (:143-180 in file) awaits the contact PATCH (:157-170), then saveClassification (:172); a throw from the second lands in the shared catch (:175-176) with the generic or server message, though the first call persisted. Retry resends both. No partial-success state exists.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx`
- **Fix steps:**
  1. Track step state: after the PATCH succeeds set `coreSaved=true`.
  2. Wrap saveClassification in its own try/catch; on failure show 'Contact details saved, but classification could not be saved. Retry' and keep the form open.
  3. On retry skip the PATCH when coreSaved and the core fields are unchanged (or only send the diff from EDIT-01).
  4. Longer term ask backend to accept classification in the contact PATCH.
- **Acceptance:**
  - Component: mock PATCH ok and classification 500 -> message mentions details saved; retry calls only classification.
  - Both ok -> success and redirect.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-CONTACTS-DETAIL-EDIT-01

### GAP-CRM-CONTACTS-DETAIL-EDIT-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The edit page ignores the loader source: an API outage renders "Contact not found" with no message and no badge, so a temporary failure looks like a deleted record (app/(app)/crm/contacts/[id]/edit/page.tsx:6).
- **Verified evidence:** edit/page.tsx:6 destructures only `data`; any null (outage, 403, 404, invalid payload) renders EmptyState 'Contact not found' (:11) with no badge or message, contrary to the detail page which at least shows the badge. fetchJson supplies `status`/`errorMessage` that are ignored.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/[id]/edit/page.tsx`
- **Fix steps:**
  1. Destructure `status` and `errorMessage` as well as data.
  2. If status===404 keep 'Contact not found'; otherwise render <LoadErrorState result={{status,errorMessage}} area='contact' backHref='/crm/contacts' />.
- **Acceptance:**
  - Test: mock status 500 -> error state with Retry, not 'not found'.
  - Mock 404 -> 'Contact not found'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-CONTACTS-DETAIL-05

### GAP-CRM-CONTACTS-DETAIL-EDIT-05  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Phone and other fields have no format validation or duplicate check here, whereas New Contact shows field-level phone/GSTIN/PAN/PIN errors and a duplicate panel; an edit can introduce invalid or duplicate data (app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx:167).
- **Verified evidence:** Edit form has only type=email on email (:200) and required on name; no phone format check and no duplicate check on edit, and errors show as one generic banner (:189). New Contact (contacts/new/page.tsx) runs duplicateCheck and maps backend validation codes to fields via parseFieldError (lib/crm/dataQuality.ts:91). Note new-contact validation is server-driven, not client formats, and the edit form has no GSTIN/PAN/PIN fields at all (see EDIT-07), so 'GSTIN/PAN/PIN errors' do not apply to edit today.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx`, `apps/web/src/lib/crm/dataQuality.ts`
- **Fix steps:**
  1. On PATCH failure read the body once and run parseFieldError({code,message}); show the message under the matching field with aria-describedby (copy the pattern from contacts/new/page.tsx).
  2. Run duplicateCheck (dataQuality.ts) on blur of email/phone when the value changed from initial and show DuplicateCheckPanel excluding the current contact id.
  3. Add client-side phone format check reusing whatever pattern the backend enforces (confirm).
- **Acceptance:**
  - Component: backend returns phone-invalid code -> error under Phone.
  - Changing email to another contact's email shows the duplicate panel.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Duplicate check on edit must exclude self or it will always flag the same record.
- **Depends on:** GAP-CRM-CONTACTS-DETAIL-EDIT-01

### GAP-CRM-CONTACTS-DETAIL-EDIT-06  ·  LOW  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** No Cancel or unsaved-changes guard: only Save changes and the back link; success redirects after a fixed 500 ms timeout (app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx:138).
- **Verified evidence:** Form has only 'Save changes' (:234) plus a top back link (:184, plain <a>); no Cancel and no dirty-state guard. Success sets message and router.push after setTimeout 500 (:174) with no cleanup, so it can fire after unmount.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx`
- **Fix steps:**
  1. Add a Cancel button (Button variant ghost) linking to /crm/contacts/{id}, confirming if dirty.
  2. Compute dirty by comparing form/classification with initial; add a beforeunload handler while dirty.
  3. Replace the timeout with immediate router.push and pass a success flag (query param or toast) or clear the timer on unmount.
- **Acceptance:**
  - Component: dirty form + Cancel opens a confirm; clean form navigates immediately.
  - No pending timer after unmount.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-CONTACTS-DETAIL-EDIT-07  ·  LOW  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Marketing consent is a bare checkbox labelled "(DPDP)"; toggling it records no purpose, timestamp or channel in the UI, and GSTIN, PAN, PIN code and Lead source captured at creation cannot be edited (app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx:195).
- **Verified evidence:** Consent is a bare checkbox 'Marketing consent (DPDP)' (:229-232) sent as marketingConsent boolean (:167); no purpose, channel or timestamp UI. The form has no fields for GSTIN, PAN, PIN or lead source (New Contact has them: contacts/new/page.tsx:29-30,150-155). Customer360Panel shows consent updatedAt read-only (:165-178) so the backend may record a time, but the edit UI captures nothing else.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx`, `apps/web/src/app/(app)/crm/contacts/[id]/edit/page.tsx`, `apps/web/src/app/_components/crm/ConsentField.tsx`
- **Fix steps:**
  1. Decide the DPDP consent record shape with the privacy owner (purpose, channel, source, timestamp, recorded-by) and confirm the backend fields.
  2. Create ConsentField (checkbox + purpose/channel selects + read-only 'last recorded' line) and use it in both New and Edit forms.
  3. Add gstin, pan, pincode, leadSource inputs to EditContactForm (and pass from getContactById if returned), with the same validation as New Contact.
- **Acceptance:**
  - Toggling consent requires a purpose/channel before save.
  - Edited GSTIN is sent and validated.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Legal (DPDP) consent evidence; do not invent fields the backend does not store.
- **Depends on:** GAP-CRM-CONTACTS-DETAIL-EDIT-05


---
## /crm/contacts/import  —  `crm/contacts-import.html`

- **Source:** `apps/web/src/app/(app)/crm/contacts/import/page.tsx`
- **Design reference:** `redesign/crm/contacts-import.html`

### GAP-CRM-CONTACTS-IMPORT-01  ·  HIGH  ·  partly  ·  theme VALIDATION (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Bulk import bypasses everything the New Contact form enforces: no duplicate check, no phone/email format validation, no consent (marketingConsent) column or default; leadStatus is cast with `as "new"` unchecked, so any string a user types is sent (app/(app)/crm/contacts/import/page.tsx:64, app/(app)/crm/contacts/new/page.tsx:104).
- **Verified evidence:** import/page.tsx:59-65 maps parsed rows to {name,email,phone,company,leadStatus} with `leadStatus: c.leadStatus as "new"` (l.64, a TS cast only; parseCsv l.36 passes any string through). No duplicate check, no email/phone/PAN format check (parseCsv l.19-40 only tests for empty name); marketingConsent is never sent. new/page.tsx:104-ish uses duplicateCheck()+parseFieldError from lib/crm/dataQuality. Whether POST v1/crm/contacts/bulk/import validates server-side (zod) is not visible: no crm-service in snapshot (only hrms-service).
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/import/page.tsx`, `apps/web/src/lib/crm/dataQuality.ts`, `apps/web/src/lib/crm/leadQualification.ts`
- **Fix steps:**
  1. Export LEAD_STATUSES (already in lib/crm/leadQualification.ts) and validate leadStatus in parseCsv against it; on mismatch mark the row invalid with a reason instead of the `as "new"` cast.
  2. Add per-row validators reusing the DQ-003 format rules behind parseFieldError (phone, email); change parseCsv to return {rows, rejected:[{line,reason}]}.
  3. Add an optional marketingConsent column defaulting to false and send it explicitly; state that default in the subtitle.
  4. Before POST, call the existing duplicate-check per batch (or surface the server result) and show matches in the preview; block on unresolved duplicates unless the user ticks 'import anyway'.
  5. Tell the backend owner to re-validate with zod (CLAUDE.md rule 9) and return per-row results.
- **Acceptance:**
  - Unit test parseCsv: 'foo' leadStatus -> rejected with reason, not sent.
  - Row with email 'abc' shows in rejected list, is not in POST body.
  - Row matching existing phone shows duplicate warning before Import enabled.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII bulk-load: bad or non-consented contacts could be created and later marketed to (DPDP). Server validation unknown.
- **Depends on:** GAP-CRM-CONTACTS-IMPORT-03, GAP-CRM-CONTACTS-IMPORT-04

### GAP-CRM-CONTACTS-IMPORT-02  ·  HIGH  ·  confirmed  ·  theme DEFAULTS (was CONFIRM)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The textarea opens pre-filled with "Sample User, user@example.com, 9900000000, Acme Corp"; the Import button is already enabled, so one click creates a junk contact (app/(app)/crm/contacts/import/page.tsx:44).
- **Verified evidence:** import/page.tsx:43-45 initialises csv state to a header plus 'Sample User,user@example.com,9900000000,Acme Corp,new'. parseCsv yields 1 row, so the submit Button (l.163-172, disabled only when busy or 0 rows) is enabled on load and one click POSTs a junk contact. No confirm step.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/import/page.tsx`
- **Fix steps:**
  1. Initialise csv to "" and move the sample into the textarea placeholder and a 'Download template' link.
  2. Keep Button disabled while preview.length===0 (already so).
  3. Open a ConfirmDialog (ds) summarising 'Import N contacts?' before POST; show only after user has typed/pasted or chosen a file.
  4. Backend already audits mutations (rule 8); no reason field needed for create, drop the maker/checker part of the generic fix.
- **Acceptance:**
  - Load page: textarea empty, Import button disabled.
  - Paste 2 rows: confirm dialog says 2 contacts; Cancel sends no request.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; removes accidental junk record creation.
- **Depends on:** GAP-CRM-CONTACTS-IMPORT-05

### GAP-CRM-CONTACTS-IMPORT-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Parsing is line.split(",") with the first line always discarded: a quoted value with a comma (e.g. "Housing & Urban Development, Odisha") silently shifts every later column, and a file without a header loses its first contact; neither is reported (app/(app)/crm/contacts/import/page.tsx:25).
- **Verified evidence:** import/page.tsx:20 `csv.trim().split("\n").slice(1)` always drops line 1 (header assumed), and l.24-26 `line.split(",")` has no quote handling, so quoted commas shift columns; CRLF leaves a trailing \r on the last field. Neither case is reported.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/import/page.tsx`, `apps/web/src/lib/crm/parseCsv.ts`
- **Fix steps:**
  1. Create lib/crm/parseCsv.ts with an RFC 4180 parser (quotes, escaped quotes, CRLF), or use papaparse if already a dependency.
  2. Detect the header by matching first-line cells to name/email/phone/company/leadStatus; if absent treat line 1 as data and show a notice.
  3. Return column count mismatches as rejected rows with line numbers.
  4. Replace parseCsv in import/page.tsx with the shared parser.
- **Acceptance:**
  - Test: '"Housing & Urban Development, Odisha",...' stays one company value.
  - Test: CSV without header keeps first row; CRLF input has no trailing \r.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; wrong-column import currently writes misplaced PII into contact fields.
- **Depends on:** GAP-CRM-CONTACTS-IMPORT-01

### GAP-CRM-CONTACTS-IMPORT-04  ·  MEDIUM  ·  confirmed  ·  theme FEEDBACK (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The result is only "Import accepted — N contacts queued" followed by a redirect after 800 ms; because the command is queue-backed there is no per-row outcome, error download or count of rejected rows (app/(app)/crm/contacts/import/page.tsx:73).
- **Verified evidence:** import/page.tsx:72-73 sets message `Import accepted — ${contacts.length} contacts queued.` and router.push('/crm/contacts') after 800 ms. The response body is never read (only res.ok, l.71) so no job id, rejected count or error file. Whether the backend returns per-row results is not visible (crm-service absent). Theme DATEFMT is wrong.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/import/page.tsx`
- **Fix steps:**
  1. Read the response JSON in submit and, if it carries a job id/counts, render an import summary card (accepted / rejected) instead of auto-redirecting.
  2. Remove the 800 ms setTimeout redirect; offer a 'View contacts' link.
  3. If backend returns rejected rows, provide a 'Download errors (CSV)' action built client-side.
  4. If the backend returns nothing, raise a backend ticket for job status/result endpoint.
- **Acceptance:**
  - After a mixed import the page stays and shows accepted and rejected counts.
  - Screen reader announces summary (role=status).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Users may assume all rows landed; silent partial failure of contact data.
- **Depends on:** GAP-CRM-CONTACTS-IMPORT-01

### GAP-CRM-CONTACTS-IMPORT-05  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Only paste input is supported (no file picker, no size cap); the preview shows 50 rows while the POST sends every valid row in a single request, so a large paste is neither reviewed nor chunked (app/(app)/crm/contacts/import/page.tsx:59).
- **Verified evidence:** import/page.tsx:59-65 posts all preview rows in one request; the preview table shows preview.slice(0,50) (l.188). Input is a textarea only (l.138-151), no file input, no size or row cap. A reusable app/_components/FileUpload.tsx exists.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/import/page.tsx`
- **Fix steps:**
  1. Add a file input (reuse app/_components/FileUpload.tsx) that reads .csv via FileReader into state, with a size cap (e.g. 2 MB).
  2. Define MAX_ROWS (e.g. 5000) and show an error above it.
  3. Chunk the POST into batches of ~500 and aggregate results, or ask backend for a file-upload endpoint.
  4. Label the preview 'Showing first 50 of N'.
- **Acceptance:**
  - Paste 6000 rows: import disabled with cap message.
  - 1200 rows send 3 requests; preview reads 'first 50 of 1200'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Chunking without idempotency could double-create on retry; check backend dedupe.
- **Depends on:** GAP-CRM-CONTACTS-IMPORT-04

### GAP-CRM-CONTACTS-IMPORT-06  ·  LOW  ·  confirmed  ·  theme FEEDBACK (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Skipped rows are counted but never shown or explained beyond "(missing name)"; invalid emails or phones are not flagged at all (app/(app)/crm/contacts/import/page.tsx:159).
- **Verified evidence:** import/page.tsx:157-161 shows '{n} valid rows ready · {m} rows skipped (missing name)'. Skipped rows are counted (l.28-29) but not listed; email/phone are not validated in parseCsv, so nothing flags them. Theme PII is wrong.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/import/page.tsx`
- **Fix steps:**
  1. Extend parseCsv result with rejected:[{line,raw,reason}].
  2. Render a collapsible 'Skipped rows' DataTable under the status line with line number and reason.
  3. Add reasons for bad email/phone once IMPORT-01 validators exist.
  4. Give the count text a specific reason breakdown.
- **Acceptance:**
  - Paste 3 rows with one blank name: list shows line 3, reason 'Missing name'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-CONTACTS-IMPORT-01, GAP-CRM-CONTACTS-IMPORT-03


---
## /crm/contacts/new  —  `crm/contacts-new.html`

- **Source:** `apps/web/src/app/(app)/crm/contacts/new/page.tsx`
- **Design reference:** `redesign/crm/contacts-new.html`

### GAP-CRM-CONTACTS-NEW-01  ·  MEDIUM  ·  confirmed  ·  theme ERRORS (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The comment says the mandatory-field 422 "falls through to the page-level error banner", but the code sets a fixed "Could not create the contact." for every non-format failure, so the user is never told which mandatory field is missing (app/(app)/crm/contacts/new/page.tsx:167).
- **Verified evidence:** new/page.tsx:359-361 comment says the LM-001 422 falls to the banner, but l.362-369 setError('Could not create the contact.') for any non-field error; body.message is read (l.362) but discarded. The form does pre-mark required fields via lead-field-rules (l.249-269), so the case is narrowed to a race with config changes or read failure.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/new/page.tsx`
- **Fix steps:**
  1. In the !res.ok branch use body?.message when present (through the safe message helper errorMessageFromResponse in lib/api/browserClient) instead of the fixed string.
  2. If the 422 names fields, map them into fieldErrors/aria-invalid on the matching inputs.
  3. Fix the comment to match behaviour.
- **Acceptance:**
  - Mock 422 'missing mandatory field(s): city' -> banner or field error mentions city.
  - Network failure still shows generic message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; ensure raw server text is not leaked (RouteError policy) - use the existing helper.

### GAP-CRM-CONTACTS-NEW-02  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Organisation is free text, not an Account picker, so a new contact is never linked to an account and the Accounts screens (Linked Contacts count, "View contacts" by name search) cannot rely on the link (app/(app)/crm/contacts/new/page.tsx:234 vs accounts/[id]/page.tsx View contacts).
- **Verified evidence:** new/page.tsx:235 (`new-company`, label 'Organisation') is a free-text input sent as `company` (l.348); no Account picker exists. accounts/[id]/page.tsx:81,129-134 shows API-supplied contactCount and 'View contacts' links to /crm/contacts?search=<account name>. Whether the backend links by name to compute contactCount cannot be verified (no crm-service). The name-search link is real.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/new/page.tsx`, `apps/web/src/app/_components/SmartCombobox.tsx`, `apps/web/src/app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx`
- **Fix steps:**
  1. Decide with backend whether contact carries accountId; if yes replace the company input with SmartCombobox over the accounts list (getCrmAccounts loader) sending accountId plus company name.
  2. Keep free text fallback 'Add new organisation'.
  3. Change accounts 'View contacts' to filter by accountId once supported.
  4. Apply same picker to EditContactForm.
- **Acceptance:**
  - Selecting an account and saving makes account detail Linked Contacts increment.
  - View contacts lists that contact even if the name differs.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Data-model change; existing contacts are unlinked, needs backfill.

### GAP-CRM-CONTACTS-NEW-03  ·  MEDIUM  ·  partly  ·  theme CONSENT (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** PAN and GSTIN are collected in the open with no purpose or notice text; PAN of an individual is personal data, and the only consent line is a bare "Marketing consent (GDPR/DPDP)" checkbox (GDPR is not the governing law here) (app/(app)/crm/contacts/new/page.tsx:252, app/(app)/crm/contacts/new/page.tsx:316).
- **Verified evidence:** new/page.tsx:238-264 GSTIN and PAN inputs have no helper text; l.315-318 checkbox reads 'Marketing consent (GDPR/DPDP)' (edit form EditContactForm.tsx says 'Marketing consent (DPDP)'). No purpose or notice text anywhere on the form (only the subtitle). GDPR mention is real; it is not the governing law. Masking is not the relevant fix here.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/new/page.tsx`, `apps/web/src/app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx`
- **Fix steps:**
  1. Change label to 'I consent to marketing communications (DPDP Act, 2023)' in both forms.
  2. Add a short notice under PAN/GSTIN: why collected (invoicing/KYC) and that access is role-scoped.
  3. Optionally capture consent timestamp/source in the POST once backend supports it.
- **Acceptance:**
  - Form shows DPDP-only wording and notice line; screen reader reads the notice via aria-describedby.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Legal wording needs sign-off from the DPO.

### GAP-CRM-CONTACTS-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme DUPLICATE-SUBMIT (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** If the create response carries no id the page shows "Contact created." but stays on the filled form with the submit button enabled, so a second click creates a duplicate (app/(app)/crm/contacts/new/page.tsx:173).
- **Verified evidence:** new/page.tsx:171-173: on success it sets message 'Contact created.' and toasts, then only redirects `if (body?.id)`. finally (l.377) clears busy, so with no id the form remains filled, the submit button is enabled again and a second click creates another record (duplicate check may catch it but ackDuplicates path allows 'Create anyway').
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/new/page.tsx`
- **Fix steps:**
  1. After success without id, router.push('/crm/contacts') (list) instead of staying.
  2. Add a `created` state that disables the submit button and inputs once success is shown.
  3. Reset the form if the user chooses 'Add another'.
- **Acceptance:**
  - Mock POST 201 with {} body: page navigates to the list; no second POST possible.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-CONTACTS-NEW-05  ·  LOW  ·  partly  ·  theme STATUS (was WIRING)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Lead status here uses "Engaged Stakeholder"/"Inactive Stakeholder", omits "disqualified", and differs from the list, filters and edit form which show the raw values qualified/unqualified (app/(app)/crm/contacts/new/page.tsx:292 vs contacts/ContactsTable.tsx).
- **Verified evidence:** new/page.tsx:289-295 options: new, contacted, qualified='Engaged Stakeholder', unqualified='Inactive Stakeholder', customer; no 'disqualified' although LeadTransitionControl.tsx:24-27 allows it. ContactsTable.tsx:52 and contacts/[id]/page.tsx:61 print raw values; EditContactForm.tsx:186 prints capitalised values (Qualified), not raw, so three variants exist.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/new/page.tsx`, `apps/web/src/app/(app)/crm/contacts/ContactsTable.tsx`, `apps/web/src/app/(app)/crm/contacts/[id]/edit/EditContactForm.tsx`, `apps/web/src/lib/crm/leadQualification.ts`
- **Fix steps:**
  1. Add LEAD_STATUS_LABELS map in lib/crm/leadQualification.ts covering every status incl. disqualified.
  2. Use it for new form options, edit form options, table cell (StatusPill) and detail page.
  3. Decide final display names (Qualified vs Engaged Stakeholder) with product.
- **Acceptance:**
  - All four screens show identical label for each enum value.
  - disqualified is selectable/visible.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-CONTACTS-06

### GAP-CRM-CONTACTS-NEW-06  ·  LOW  ·  confirmed  ·  theme COPY (was FABRICATED)

- [x] **Status** (W2 2026-10-16: closed by #N, W2 crm: closed by #N)
- **First-pass claim:** Placeholders come from another state: "Asha Rao", "Bengaluru", "560001", GSTIN 29ABCDE1234F1Z5 (a Karnataka code); an Odisha tenant sees wrong examples (app/(app)/crm/contacts/new/page.tsx:244).
- **Verified evidence:** new/page.tsx placeholders: 'e.g. Asha Rao' (l.212), GSTIN '29ABCDE1234F1Z5' (l.244; 29 = Karnataka), city 'Bengaluru' (l.266), PIN '560001' (l.274), phone 9900000000. They are placeholders, not saved data.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/new/page.tsx`
- **Fix steps:**
  1. Replace with neutral or locale examples (e.g. 'Full name', GSTIN '21ABCDE1234F1Z5', city 'Bhubaneswar', PIN '751001') or drive from tenant config.
  2. Apply the same in EditContactForm if duplicated.
- **Acceptance:**
  - No Karnataka examples remain on the form.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-CONTACTS-NEW-07  ·  LOW  ·  confirmed  ·  theme COPY (was LOADING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** error.tsx names the area "CRM New", so the boundary reads "We couldn't open CRM New." (app/(app)/crm/contacts/new/error.tsx:12).
- **Verified evidence:** new/error.tsx:12 passes area="CRM New" to RouteError, which renders 'We couldn't open CRM New.' (RouteError.tsx sentence). Same string used in crm/deals/new, opportunities/new error.tsx.
- **Files to change:** `apps/web/src/app/(app)/crm/contacts/new/error.tsx`, `apps/web/src/app/(app)/crm/deals/new/error.tsx`, `apps/web/src/app/(app)/crm/opportunities/new/error.tsx`, `apps/web/src/app/(app)/crm/deals/[id]/error.tsx`
- **Fix steps:**
  1. Set area="the new contact form" here (RouteError adds no article, so use 'New Contact').
  2. Fix siblings ('CRM New', 'CRM [Id]') the same way.
  3. Optionally add a lint/test that forbids area values containing '[' or ending in 'New'.
- **Acceptance:**
  - Force an error: text reads 'We couldn't open New Contact.'
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /crm/control-tower  —  `crm/control-tower.html`

- **Source:** `apps/web/src/app/(app)/crm/control-tower/page.tsx`
- **Design reference:** `redesign/crm/control-tower.html`

### GAP-CRM-CONTROL-TOWER-01  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The card is titled "GIS — pipeline by region" and the empty state says regions "appear on the heat map", but the code renders a plain table with no map or heat colouring (app/(app)/crm/control-tower/page.tsx:70).
- **Verified evidence:** control-tower/page.tsx:57 Card title 'GIS — pipeline by region', :70 emptyMessage '...appear on the heat map', :47 subtitle 'Regional pipeline heat'; the body is a DataTable (l.58-72) with no map or colour scale.
- **Files to change:** `apps/web/src/app/(app)/crm/control-tower/page.tsx`
- **Fix steps:**
  1. Rename the card to 'Pipeline by region' and change emptyMessage/subtitle to drop 'GIS'/'heat map'.
  2. Or, if a map is intended, add horizontal bar/heat cells to the Pipeline column (reuse app/_components/maps if suitable).
- **Acceptance:**
  - No 'heat map' or 'GIS' wording without a map.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-CONTROL-TOWER-02  ·  MEDIUM  ·  partly  ·  theme DATA-QUALITY (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Regions come from the contact "region" field, which the contact forms capture as free text with placeholder "e.g. South, West"; the same district spelt two ways splits the pipeline into separate rows (app/_components/crm/ClassificationFields.tsx:83, app/(app)/crm/control-tower/page.tsx:70).
- **Verified evidence:** ClassificationFields.tsx region input is free text with placeholder 'e.g. South, West'. Region aggregation for control tower is done by the backend (getCrmControlTower -> /api/v1/crm/dashboard/control-tower, loaders.ts:3109); page only renders data.regions (page.tsx:26-32). Whether the backend normalises/case-folds cannot be verified. Split rows for spelling variants is plausible but unproven. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/_components/crm/ClassificationFields.tsx`, `apps/web/src/app/(app)/crm/control-tower/page.tsx`
- **Fix steps:**
  1. Replace the free-text region with a select fed by a tenant region master (or fixed list of districts/zones) in ClassificationFields.
  2. Backend: normalise region (trim/case-fold) on write and in aggregation.
  3. In tower.ts group by trimmed lowercase key as an interim safeguard.
- **Acceptance:**
  - Same district entered with different case appears once on the control tower.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Needs region master decision; backfill of existing values.

### GAP-CRM-CONTROL-TOWER-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** When the feed fails the whole page becomes "Control tower unavailable" with a small badge and no Retry or Back action, unlike the RefreshErrorState used on account detail; the title also changes to "Control Tower" (app/(app)/crm/control-tower/page.tsx:20).
- **Verified evidence:** page.tsx:16-24: `if (!data)` returns PageHeader title 'Control Tower' plus EmptyState 'Control tower unavailable' (no action), and the badge only if source==='error'. Success title is 'Executive Control Tower' (l.45). RefreshErrorState (ds/RefreshErrorState.tsx) is available for server pages. Also l.102 `source==="error" &&` is effectively dead because error yields data=null.
- **Files to change:** `apps/web/src/app/(app)/crm/control-tower/page.tsx`, `apps/web/src/lib/messages.ts`
- **Fix steps:**
  1. Keep the same title 'Executive Control Tower' in the error branch.
  2. When source==='error' render <RefreshErrorState error={{what:'Control tower could not be loaded', next:'...', actions:['retry','back']}} backHref='/crm'/>.
  3. Only use EmptyState when source==='api' and data is legitimately null.
  4. Remove dead badge branch.
- **Acceptance:**
  - Mock loader error: title unchanged, Retry re-fetches via router.refresh(), Back goes to /crm.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-CONTROL-TOWER-04  ·  MEDIUM  ·  partly  ·  theme ROBUSTNESS (was LOADING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** rankRegions calls BigInt(pipelineMinor || "0") without a guard; a decimal or malformed string throws during render and takes down the whole route to error.tsx (app/(app)/crm/control-tower/tower.ts:5).
- **Verified evidence:** tower.ts:5-6 `BigInt(a.pipelineMinor || "0")` throws SyntaxError on '12.5' or 'abc', which would bubble to error.tsx. Whether crmControlTowerSchema (from @civitasone/types, absent from snapshot, imported loaders.ts:219) already constrains pipelineMinor to an integer string cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/crm/control-tower/tower.ts`
- **Fix steps:**
  1. Add safeBig(v): try BigInt(v) catch return 0n (or use parseMinor from _data/apiMappers).
  2. Use it in rankRegions; log a warning without console.log.
  3. Add unit tests in tower.test.ts.
- **Acceptance:**
  - rankRegions with pipelineMinor '1.5' does not throw and sorts as 0.
  - Valid strings sort as before.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Silently treating malformed money as 0 could hide bad data; prefer showing '—' in the row.

### GAP-CRM-CONTROL-TOWER-05  ·  LOW  ·  partly  ·  theme LABELS (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** "Exception volume" adds counts across different exception types, so one dormant, overdue account is counted several times and the total is not a number of records (app/(app)/crm/control-tower/tower.ts:19).
- **Verified evidence:** tower.ts:19-21 totalExceptionCount sums e.count across all exception types and page.tsx:105 shows it as 'Exception volume'. Overlap between types (same account in several) depends on backend definitions and cannot be verified; summing counts is code-true.
- **Files to change:** `apps/web/src/app/(app)/crm/control-tower/tower.ts`, `apps/web/src/app/(app)/crm/control-tower/page.tsx`
- **Fix steps:**
  1. Rename stat to 'Open exception items' with a sub-label 'items may appear in more than one category', or drop the total.
  2. Or ask the backend for a distinct-record total and display that.
- **Acceptance:**
  - Label clarifies the number is a sum of category counts.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-CONTROL-TOWER-06  ·  LOW  ·  partly  ·  theme NAV/SECURITY (was NAVUX)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The Open button uses a plain <a href={row.href}> with the API-supplied string, no allow-list or client navigation, so it reloads the app and trusts the feed for the target (app/(app)/crm/control-tower/ExceptionTable.tsx:21).
- **Verified evidence:** ExceptionTable.tsx:21 `<a className="btn" href={row.href}>Open</a>`: full page load and unvalidated href from the feed. Risk is low because the feed is the app's own API; javascript: URLs would be an issue only if the backend were compromised.
- **Files to change:** `apps/web/src/app/(app)/crm/control-tower/ExceptionTable.tsx`
- **Fix steps:**
  1. Use next/link.
  2. Guard: only render a link when href startsWith('/') and not '//'; otherwise render disabled 'Open'.
  3. Give the button an aria-label with the exception label.
- **Acceptance:**
  - href 'javascript:x' is not rendered as a link.
  - Internal href navigates client-side without reload.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-CONTROL-TOWER-07  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 closed by #1860, verified on main 9c5e9e9e9; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** loading.tsx is one line of text ("Loading control tower…") while every sibling uses skeleton blocks (app/(app)/crm/control-tower/loading.tsx:2).
- **Verified evidence:** control-tower/loading.tsx:1-3 is `<div className="page-main"><p>Loading control tower…</p></div>`; crm/accounts/loading.tsx and contacts/new/loading.tsx use animate-pulse skeleton blocks.
- **Files to change:** `apps/web/src/app/(app)/crm/control-tower/loading.tsx`
- **Fix steps:**
  1. Copy the skeleton from crm/accounts/loading.tsx: title bar, two stat blocks, one card table block, one card block.
- **Acceptance:**
  - Throttle network: skeleton shape matches stat grid and two cards.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /crm/custom-fields  —  `crm/custom-fields.html`

- **Source:** `apps/web/src/app/(app)/crm/custom-fields/page.tsx`
- **Design reference:** `redesign/crm/custom-fields.html`

### GAP-CRM-CUSTOM-FIELDS-01  ·  HIGH  ·  partly  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** An admin can define a Text field named anything (e.g. Aadhaar or PAN) on contacts, leads or deals; the form has no sensitivity, masking or role-visibility setting, so the value would render unmasked on every record for every CRM role (lib/crm/customFields.ts:178).
- **Verified evidence:** CustomFieldsManager.tsx:229-256 offers only name, type (text/number/date/boolean/select/multi_select), required, order; buildValidationSchema (customFields.ts:178-189) persists only required+options, so no sensitivity/mask/role-visibility can be defined. Admin-only via custom-fields/layout.tsx. However no web screen in this snapshot reads or renders custom-field VALUES (only the definitions manager uses customFields.ts), and crm-service is absent, so the 'renders unmasked on every record' consequence cannot be seen; the missing control is real. No shared <Masked> exists in ds (only a local MaskedInput in hr Step4).
- **Files to change:** `apps/web/src/lib/crm/customFields.ts`, `apps/web/src/app/(app)/crm/custom-fields/_components/CustomFieldsManager.tsx`, `apps/web/src/app/_components/ds/Masked.tsx`
- **Fix steps:**
  1. Extend CustomFieldValidation/CustomFieldDraft with `sensitive?: boolean` and `visibleToRoles?: string[]` stored inside validationSchema (buildValidationSchema, toDraft).
  2. Add a 'Sensitive (mask on records)' checkbox and a role multi-select to the definition card in CustomFieldsManager.
  3. Show a warning when fieldName matches /aadhaar|pan|passport|ration|bank|account no/i and default sensitive=true.
  4. Create shared ds <Masked value revealRole onReveal> that masks by default and posts an audit event on reveal; use it wherever custom values render (none yet in web).
  5. Backend to enforce: strip sensitive values server-side for roles not in visibleToRoles and exclude them from CSV export.
- **Acceptance:**
  - Unit: buildValidationSchema({sensitive:true}) returns {sensitive:true}; toDraft round-trips it.
  - Manual: name a Text field 'Aadhaar', card shows the warning and sensitive pre-ticked.
  - Record view (once built) shows masked value; reveal writes an audit event.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII: today an admin can create an Aadhaar/PAN text field with no protection; DPDP exposure. validationSchema is free-form so no migration but backend enforcement is required.
- **Depends on:** shared <Masked> component

### GAP-CRM-CUSTOM-FIELDS-02  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The Type select stays editable on a saved definition; switching Text to Number or Single select to Text has no warning although records already hold values, unlike Delete which has a ConfirmDialog (app/(app)/crm/custom-fields/_components/CustomFieldsManager.tsx:250).
- **Verified evidence:** CustomFieldsManager.tsx:246-255 the Type <select> is enabled for saved rows (row.id set); onChange only calls update(). Save then sends fieldType via updateCustomField (customFields.ts:~248 PATCH body includes fieldType). Delete alone uses ConfirmDialog (335-348). No warning about existing values. (Line ref 250 is the select's aria-label; block is 246-255.)
- **Files to change:** `apps/web/src/app/(app)/crm/custom-fields/_components/CustomFieldsManager.tsx`
- **Fix steps:**
  1. In the Type <select> for rows with row.id, on change keep original type in state (e.g. row.origType from toDraft) and show inline warning 'Changing type may make existing values invalid'.
  2. In save(), if row.id && row.fieldType !== row.origType, open the existing ConfirmDialog (new confirmTypeChange key) before calling updateCustomField.
  3. Alternatively disable the select for saved rows (delete + recreate) - product decision.
  4. Audit event / mandatory reason belongs to backend PATCH handler; do not invent client-side audit.
- **Acceptance:**
  - Component test: edit saved text field to number, click Save -> confirm dialog appears; Cancel makes no PATCH call.
  - Editing name only saves without dialog.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Data integrity: silent type change can orphan or corrupt captured values.

### GAP-CRM-CUSTOM-FIELDS-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Save is a 202 (queue-backed) mutation followed immediately by a reload; the success line "Custom field “x” saved." can appear while the reloaded list does not yet contain the change (app/(app)/crm/custom-fields/_components/CustomFieldsManager.tsx:152).
- **Verified evidence:** CustomFieldsManager.tsx:147-153 awaits create/update (which resolves on the 202 accepted per customFields.ts header comment), sets message at 152 then immediately load() at 153. If the consumer write has not landed, the list reloads without the change while the message says 'saved'. Real race but depends on backend consumer latency (crm-service not in snapshot, cannot measure); new rows would also vanish from the list since load() replaces rows with server data.
- **Files to change:** `apps/web/src/app/(app)/crm/custom-fields/_components/CustomFieldsManager.tsx`
- **Fix steps:**
  1. Change success copy to 'Custom field “x” submitted; it may take a moment to appear.'
  2. After save, poll load() up to ~3 times (500ms/1s/2s) until the field name/ordinal appears (create) or matches (update); keep the local row meanwhile.
  3. Only set message after confirmation, otherwise show 'Still processing - refresh'.
  4. Keep gen guard from load(entity, gen) in polling loop.
- **Acceptance:**
  - Test with mocked list returning stale data twice then fresh: message says 'submitted' until fresh, no lost draft.
  - Manual: create field, it stays visible in list.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; extra reads only.

### GAP-CRM-CUSTOM-FIELDS-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Delete copy says the field "will be removed from leads/contacts/deals" but does not say whether values already captured on records are deleted or retained, which matters for retention and RTI (app/(app)/crm/custom-fields/_components/CustomFieldsManager.tsx:340).
- **Verified evidence:** CustomFieldsManager.tsx:338-342 description: '“x” will be removed from leads. This cannot be undone.' - silent on whether captured values on records are deleted or retained. Backend behaviour is unknown (crm-service absent).
- **Files to change:** `apps/web/src/app/(app)/crm/custom-fields/_components/CustomFieldsManager.tsx`
- **Fix steps:**
  1. Confirm with backend whether DELETE removes stored values; then change description to state it explicitly (e.g. 'Values already captured on existing records will be kept/permanently deleted').
  2. If values are deleted, require typing the field name in ConfirmDialog.
  3. Note retention/RTI implication in one line.
- **Acceptance:**
  - Dialog text names the outcome for existing values.
  - If destructive, confirm button disabled until name typed.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Retention/RTI: user may believe data is preserved; irreversible delete.

### GAP-CRM-CUSTOM-FIELDS-05  ·  LOW  ·  partly  ·  theme VALIDATION (was CAP)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Validation only checks empty, >64 chars and missing select options; a duplicate field name within an entity is not checked client-side (lib/crm/customFields.ts:192).
- **Verified evidence:** validateDraft (customFields.ts:192-205) checks empty, >64, and select options only; no duplicate-name check within rows. The server may reject duplicates (crm-service not visible) - if so the error surfaces via errorMessageFromResponse at save (152-155). Theme CAP is wrong.
- **Files to change:** `apps/web/src/lib/crm/customFields.ts`, `apps/web/src/app/(app)/crm/custom-fields/_components/CustomFieldsManager.tsx`
- **Fix steps:**
  1. Add optional param `siblings: CustomFieldDraft[]` to validateDraft returning errors.fieldName='A field with this name already exists.' on case-insensitive trim match excluding self (by id/key).
  2. Pass rows (other than the current) from CustomFieldsManager save() and inline render.
  3. Keep server check authoritative.
- **Acceptance:**
  - Unit: two drafts 'Grade' and ' grade ' -> second gets error.
  - Editing own name unchanged -> no error.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-CUSTOM-FIELDS-06  ·  LOW  ·  confirmed  ·  theme CONFIRM (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Switching the entity type replaces the list, discarding any unsaved new definition or edits without warning (app/(app)/crm/custom-fields/_components/CustomFieldsManager.tsx:104).
- **Verified evidence:** CustomFieldsManager.tsx:99-104 effect on [entity] calls load() which setRows(server data) (93), discarding unsaved new rows/edits; Segmented onChange (197-200) switches immediately without a dirty check. The stale-response guard exists but not a dirty guard.
- **Files to change:** `apps/web/src/app/(app)/crm/custom-fields/_components/CustomFieldsManager.tsx`
- **Fix steps:**
  1. Track dirty rows (compare to loaded snapshot or rows with key starting 'new-').
  2. In Segmented onChange, if dirty, open ConfirmDialog 'Discard unsaved changes?' before setEntity.
  3. Optionally add beforeunload guard.
- **Acceptance:**
  - Add a new blank row, click another entity -> confirm dialog; Cancel keeps row and entity.
  - No dialog when nothing edited.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-CUSTOM-FIELDS-07  ·  LOW  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Entity labels say "Deals" while the Deals screen and dashboard call them "Engagements" (lib/crm/customFields.ts:33, app/(app)/crm/deals/page.tsx:16).
- **Verified evidence:** customFields.ts:33 ENTITY_TYPE_LABELS.deals = 'Deals'; crm/deals/page.tsx:16 title is 'Vendor / Stakeholder Engagements', dashboard says Engagements. Hub tile (crm/page.tsx) says 'Deals'. Terminology is mixed across module.
- **Files to change:** `apps/web/src/lib/crm/customFields.ts`, `apps/web/src/app/(app)/crm/custom-fields/_components/CustomFieldsManager.tsx`
- **Fix steps:**
  1. Decide canonical term (Engagements per deals screen).
  2. Change ENTITY_TYPE_LABELS.deals to 'Engagements' (label only; key stays 'deals').
  3. Update page subtitle 'leads, contacts and deals' and hub tile for consistency.
- **Acceptance:**
  - Custom fields tab reads 'Engagements'; API path still /custom-fields/deals.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None; label-only.


---
## /crm/dashboard  —  `crm/dashboard.html`

- **Source:** `apps/web/src/app/(app)/crm/dashboard/page.tsx`
- **Design reference:** `redesign/crm/dashboard.html`

### GAP-CRM-DASHBOARD-01  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** When the dashboard fetch fails the stat cards render 0, 0, 0 and ₹0.00 next to the small "Couldn't load" badge; the Accounts, Contacts and Activities pages show "—" for exactly this case, so this one can read as "no contacts, no engagements" (app/(app)/crm/dashboard/page.tsx:27, app/_data/loaders.ts:2723).
- **Verified evidence:** dashboard/page.tsx:27-30 renders dash.* directly; on failure getCRMDashboard falls back to CRM_DASHBOARD_EMPTY (loaders.ts:2723-2728, all zeros) so cards show 0,0,0 and formatMoney(0) beside a DataSourceBadge (line 25). Contacts/Accounts/Activities pages use stat=(n)=>source==='error'?'—':... (contacts/page.tsx:37).
- **Files to change:** `apps/web/src/app/(app)/crm/dashboard/page.tsx`
- **Fix steps:**
  1. Add `const stat = (n:number)=> source==='error' ? '—' : n.toLocaleString('en-IN')` as in contacts/page.tsx:37.
  2. Use stat() for the three counts and `source==='error' ? '—' : formatMoney(dash.pipelineValue)`.
  3. Optionally render <RefreshErrorState error={toHumanError('load',{area:'CRM dashboard'})} backHref='/crm'/> instead of the bare badge.
- **Acceptance:**
  - Mock getCRMDashboard source:'error' -> all four cards show '—'.
  - Success -> numbers unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; prevents reading outage as zero engagements.
- **Depends on:** RefreshErrorState

### GAP-CRM-DASHBOARD-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The banner says the module is "not a commercial sales pipeline" while the hub offers Sales & Pipeline, Pipeline Board, Quotations and Price Books under the same module (app/(app)/crm/dashboard/page.tsx:46, app/(app)/crm/page.tsx:18).
- **Verified evidence:** dashboard/page.tsx:44-47 banner says 'not a commercial sales pipeline'; crm/page.tsx:17-26 hub has 'Sales & Pipeline' section with Pipeline Board, Opportunities, Quotations, and Price Books under Products & Pricing. Contradictory copy (line refs: hub ~15-26 not 18).
- **Files to change:** `apps/web/src/app/(app)/crm/dashboard/page.tsx`, `apps/web/src/app/(app)/crm/page.tsx`
- **Fix steps:**
  1. Product decision on positioning.
  2. Reword banner (e.g. 'Focus is stakeholder and vendor engagement; procurement pipeline tools are under Sales & Pipeline') or rename hub section.
  3. Move string to next-intl if adopting.
- **Acceptance:**
  - Banner no longer contradicts hub sections.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-DASHBOARD-03  ·  LOW  ·  confirmed  ·  theme COPY (was LOADING)

- [x] **Status** (W0 2026-10-13 closed by #1860, verified on main 9c5e9e9e9; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** The loading skeleton prints the heading "Dashboard" while the loaded page title is "CRM", so the h1 changes as the page paints; the hub tile is "Dashboard" too (app/(app)/crm/dashboard/loading.tsx:6, app/(app)/crm/dashboard/page.tsx:13).
- **Verified evidence:** dashboard/loading.tsx:6 h1 'Dashboard' (id page-heading, own page-main wrapper); page.tsx:13 title 'CRM'; hub tile is 'Dashboard' (crm/page.tsx:10). Heading flips on paint. Loading.tsx also has no subtitle/actions.
- **Files to change:** `apps/web/src/app/(app)/crm/dashboard/loading.tsx`, `apps/web/src/app/(app)/crm/dashboard/page.tsx`
- **Fix steps:**
  1. Decide title; set both to same string (recommend title 'CRM Dashboard').
  2. Better: in loading.tsx reuse the PageHeader skeleton.
- **Acceptance:**
  - Loading and loaded h1 identical.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-DASHBOARD-04  ·  LOW  ·  confirmed  ·  theme NAVUX (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Stat cards are not links: Contacts, Engagements and Interactions Today do not drill into their lists (the Quick links card repeats three of them separately); Interactions Today has no link to the activities "Today" segment (app/(app)/crm/dashboard/page.tsx:29).
- **Verified evidence:** dashboard/page.tsx:27-30 StatCard (ds/StatCard.tsx:27) has no href prop, so cards are not links. Quick links (34-36) cover Contacts, Engagements, Activities only. Activities table supports ?segment=Today (ActivitiesTable.tsx:22-39), so a drill link is feasible.
- **Files to change:** `apps/web/src/app/_components/ds/StatCard.tsx`, `apps/web/src/app/(app)/crm/dashboard/page.tsx`
- **Fix steps:**
  1. Add optional `href` prop to StatCard rendering the card as <Link> with focus style.
  2. Set hrefs: /crm/contacts, /crm/deals, /crm/activities?segment=Today; Value card -> /crm/deals.
  3. Keep Quick links or drop the duplicates.
- **Acceptance:**
  - Clicking Interactions Today opens activities with Today segment selected.
  - Keyboard focus/Enter works.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; StatCard is shared so check other usages unchanged.
- **Depends on:** StatCard href

### GAP-CRM-DASHBOARD-05  ·  LOW  ·  partly  ·  theme NAVUX (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Quick links list three of the module's 35 screens and duplicate the header buttons; "Engagements" here versus "Deals" on the hub (app/(app)/crm/dashboard/page.tsx:28).
- **Verified evidence:** Quick links (page.tsx:33-37) do list three screens; hub crm/page.tsx has ~35 tiles (count of href: lines = 35). But they do NOT duplicate the header buttons (those are '+ New Contact' / '+ New Engagement', lines 20-21). 'Engagements' here vs 'Deals' on the hub is true (hub crm/page.tsx:15).
- **Files to change:** `apps/web/src/app/(app)/crm/dashboard/page.tsx`, `apps/web/src/app/(app)/crm/page.tsx`
- **Fix steps:**
  1. Align term (Engagements vs Deals) across hub tile and quick links.
  2. Optionally extend Quick links with Accounts, Pipeline Board, Grievances.
- **Acceptance:**
  - Same noun on hub tile and dashboard link.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-DASHBOARD-06  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle has a hard-coded Devanagari suffix, not a next-intl key, and not Odia for an Odisha tenant (app/(app)/crm/dashboard/page.tsx:14).
- **Verified evidence:** dashboard/page.tsx:14 subtitle ends with '• सरकारी हितधारक पंजी' hard-coded literal; no getTranslations use in this file (hub crm/page.tsx does import next-intl). Odia not provided.
- **Files to change:** `apps/web/src/app/(app)/crm/dashboard/page.tsx`
- **Fix steps:**
  1. Import getTranslations('crm.dashboard') and add subtitle key in en/hi/or message files.
  2. Drop the hard-coded Devanagari suffix, render locale-appropriate string.
- **Acceptance:**
  - Switching locale to or changes subtitle to Odia; no hard-coded suffix remains.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /crm/data-quality  —  `crm/data-quality.html`

- **Source:** `apps/web/src/app/(app)/crm/data-quality/page.tsx`
- **Design reference:** `redesign/crm/data-quality.html`

### GAP-CRM-DATA-QUALITY-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The Record column prints the raw id (a UUID) as the link text, so a data steward sees a list of ids with a score and issue text but no name to recognise the contact or account to fix (app/_components/crm/DataQualityView.tsx:141).
- **Verified evidence:** DataQualityView.tsx:142 renders <a>{r.id}</a>; DqRecord (lib/crm/dataQuality.ts:52-56) carries only id, score, issues - no name field, so the web cannot show a name without the backend adding one (mapper at dataQuality.ts ~225 maps only those). Whether the API returns a name cannot be verified (crm-service absent). Line ref 141 -> 142.
- **Files to change:** `apps/web/src/lib/crm/dataQuality.ts`, `apps/web/src/app/_components/crm/DataQualityView.tsx`
- **Fix steps:**
  1. Extend DqRecord with optional `name?: string` and map it from the response in the report mapper.
  2. Render `r.name ?? 'Unnamed record'` as link text, with id in muted small/title only.
  3. Backend: include display name (contact name / account name) in data-quality records for each entity.
- **Acceptance:**
  - Row shows contact name linking to /crm/contacts/:id; no bare UUID visible.
  - Fallback text when name missing.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; backend contract change needed.

### GAP-CRM-DATA-QUALITY-02  ·  MEDIUM  ·  confirmed  ·  theme DATAVIZ (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Distribution bars are scaled to the largest bucket, not to the share of records, so a 1,123-record top bucket makes 8, 21 and 96 look negligible and the bars cannot be read as percentages of the master (app/_components/crm/DataQualityView.tsx:101).
- **Verified evidence:** DataQualityView.tsx:65 maxBucket = largest count; line 101 ProgressBar value=(count/maxBucket)*100. Bars are relative to the biggest bucket, not to total records.
- **Files to change:** `apps/web/src/app/_components/crm/DataQualityView.tsx`
- **Fix steps:**
  1. Compute total = sum of distribution counts; use value=(b.count/total)*100.
  2. Show '(x%)' next to count.
  3. Keep aria-label with percent.
- **Acceptance:**
  - Buckets 1123/96/21/8 render bars ~88/7.5/1.6/0.6 percent.
  - Total zero -> 0 width, no NaN.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-DATA-QUALITY-03  ·  MEDIUM  ·  confirmed  ·  theme LOADING (was NAVUX)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The report is refetched on every Entity or Tab change (useEffect on [entity, filter]) and stats flip to "…" each time, so clicking Invalid format re-loads the counts and distribution that did not change (app/_components/crm/DataQualityView.tsx:60).
- **Verified evidence:** DataQualityView.tsx:49-60 one effect on [entity, filter] calls getDataQuality(entity, filter) and setSource('loading'), so stats show '…' (84-86) and distribution re-fetches on every Tab change. Counts/distribution are independent of filter per DataQualityReport shape (only records change).
- **Files to change:** `apps/web/src/app/_components/crm/DataQualityView.tsx`, `apps/web/src/lib/crm/dataQuality.ts`
- **Fix steps:**
  1. Fetch report per entity only (effect on [entity]); cache per-entity report in state/Map.
  2. Filter tabs switch records client-side if the API returns all three lists, else fetch records only, keeping stats mounted (don't set loading on filter change).
  3. Show inline spinner only in the records card.
- **Acceptance:**
  - Clicking Invalid format does not blank the stat cards or distribution.
  - Network shows no extra request for counts (if API allows).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; verify API signature getDataQuality(entity, filter) can return records for all filters.

### GAP-CRM-DATA-QUALITY-04  ·  LOW  ·  confirmed  ·  theme NAVUX (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** "Leads" and "Contacts" are separate entity options but both drill into /crm/contacts/:id, so the selector suggests two datasets that open the same screen (app/_components/crm/DataQualityView.tsx:35).
- **Verified evidence:** DataQualityView.tsx:33-37 DETAIL_BASE maps both contacts and leads to /crm/contacts/, selector options at 19-25. Whether leads are the same table as contacts in crm-service cannot be verified.
- **Files to change:** `apps/web/src/app/_components/crm/DataQualityView.tsx`
- **Fix steps:**
  1. Confirm whether /crm/leads/:id exists (grep app/(app)/crm/leads); if so point leads there.
  2. Otherwise remove 'Leads' option or relabel 'Leads & Contacts'.
- **Acceptance:**
  - Leads records open the correct screen.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-DATA-QUALITY-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The header "Matching rules" link goes to an admin-only route; a crm_user is redirected straight back to /crm/data-quality with no explanation (app/(app)/crm/data-quality/page.tsx:13, app/(app)/crm/dedup-rules/layout.tsx:2).
- **Verified evidence:** data-quality/page.tsx:13 header has an unconditional 'Matching rules' link to /crm/dedup-rules; dedup-rules/layout.tsx:9-10 requireAnyRole(ALLOWED_ROLES,'/crm/data-quality') redirects non-admins back with no message.
- **Files to change:** `apps/web/src/app/(app)/crm/data-quality/page.tsx`, `apps/web/src/app/(app)/crm/dedup-rules/layout.tsx`
- **Fix steps:**
  1. Make page.tsx read roles (as roleGuard does; reuse the helper in lib/auth) and render the link only for ALLOWED_ROLES.
  2. Export ALLOWED_ROLES from a shared crm roles constant to avoid drift.
- **Acceptance:**
  - crm_user does not see 'Matching rules'; crm_admin does.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; UI hiding only, layout guard remains.

### GAP-CRM-DATA-QUALITY-06  ·  LOW  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Quality score is shown as a rounded percentage with no description of how it is computed or what threshold counts as "missing" versus "stale" (app/_components/crm/DataQualityView.tsx:143).
- **Verified evidence:** DataQualityView.tsx:143 shows Math.round(r.score*100)% with header 'Quality score' (135); no tooltip/help text about scoring or thresholds for missing/stale. Actual rules are server-side (not visible).
- **Files to change:** `apps/web/src/app/_components/crm/DataQualityView.tsx`
- **Fix steps:**
  1. Add a help note / tooltip under the table heading describing score = share of completed/valid fields.
  2. Get exact definitions of missing/invalid/stale thresholds from backend and put in copy.
- **Acceptance:**
  - Info text visible with definitions of each filter.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-DATA-QUALITY-07  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Title carries a hard-coded Devanagari suffix, not a next-intl key, and not Odia for an Odisha tenant (app/(app)/crm/data-quality/page.tsx:9).
- **Verified evidence:** data-quality/page.tsx:9 title 'Data Quality • डेटा गुणवत्ता' hard-coded; no next-intl; no Odia.
- **Files to change:** `apps/web/src/app/(app)/crm/data-quality/page.tsx`
- **Fix steps:**
  1. Move title to next-intl key crm.dataQuality.title in en/hi/or.
  2. Title renders only the active-locale string.
- **Acceptance:**
  - Odia locale shows Odia title; no suffix.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /crm/deals  —  `crm/deals.html`

- **Source:** `apps/web/src/app/(app)/crm/deals/page.tsx`
- **Design reference:** `redesign/crm/deals.html`

### GAP-CRM-DEALS-01  ·  MEDIUM  ·  confirmed  ·  theme I18N

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The Won→Concluded / Lost→Lapsed relabel uses case-sensitive \bWon\b and \bLost\b, but mapDealSummaries lower-cases stages to closed_won / closed_lost, so rows show "closed won" and "closed lost" and the intended vocabulary never appears (app/(app)/crm/deals/DealsTable.tsx:27, app/_data/apiMappers.ts:499).
- **Verified evidence:** DealsTable.tsx:86 does d.stage.replace(/_/g,' ').replace(/\bWon\b/,'Concluded').replace(/\bLost\b/,'Lapsed') (cited :27 is wrong). mapDealSummaries/normalizeDealStage (apiMappers.ts:499-500) always yields closed_won/closed_lost, so the string becomes 'closed won'/'closed lost' and neither case-sensitive regex matches. Rows show 'closed won'.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/DealsTable.tsx`
- **Fix steps:**
  1. Replace the regex chain with a STAGE_LABEL map {prospecting:'Prospecting', proposal:'Proposal', negotiation:'Negotiation', closed_won:'Concluded', closed_lost:'Lapsed', qualification:'Qualification'}.
  2. Fall back to humanizeStatus (lib/formatters.ts:44) for unknown keys.
  3. Move labels to next-intl keys.
- **Acceptance:**
  - Unit test: closed_won -> 'Concluded', closed_lost -> 'Lapsed'.
  - Manual: won row shows 'Concluded' in the Stage column.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; check StatusPill colouring keys off cellType status text after relabel.
- **Depends on:** GAP-CRM-DEALS-02

### GAP-CRM-DEALS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Lost engagements appear only under All: "Open" filters status open and "Concluded" filters status won, so a lapsed engagement has no segment and no stat card counts it (app/(app)/crm/deals/DealsTable.tsx:42).
- **Verified evidence:** DealsTable.tsx:76-80: 'Open' -> status==='open', 'Concluded' -> status==='won', else all. SEGMENTS (:63) has no lost option; deals/page.tsx:28-31 stat cards count total, open and won value only, so lost engagements are visible only under All and in no stat.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/DealsTable.tsx`, `apps/web/src/app/(app)/crm/deals/page.tsx`
- **Fix steps:**
  1. Add a 'Lapsed' segment (status==='lost') to SEGMENTS and the filter.
  2. Add a Lapsed count/value StatCard or fold it into Total sub-label.
  3. Show segment counts in the labels.
- **Acceptance:**
  - Component test: rows with status lost appear only under All and Lapsed.
  - Manual: Lapsed segment count equals stat card.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-DEALS-01

### GAP-CRM-DEALS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed load the stat cards print 0 and ₹0.00 (deals.length is used directly, no "—" guard as on Accounts/Contacts) while the badge is inside the table card below (app/(app)/crm/deals/page.tsx:28).
- **Verified evidence:** deals/page.tsx:28-31 renders deals.length, openDeals and formatMoney sums directly; getDeals (loaders.ts:2769-2775) returns [] with source 'error' on failure, so cards show 0 and ₹0.00. `source` is only forwarded to DealsTable (:33), where the badge lives (DealsTable.tsx:118), and useSeededResource may serve cached rows so cards (server data) and table can disagree.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/page.tsx`, `apps/web/src/app/(app)/crm/deals/DealsTable.tsx`
- **Fix steps:**
  1. Compute the stat values inside a client wrapper that uses the same useSeededResource rows as the table, or pass source and render '—' when source==='error' and no cached rows.
  2. Render the DataSourceBadge/RefreshErrorState above the StatGrid.
  3. Follow the '—' guard used on Accounts/Contacts pages.
- **Acceptance:**
  - Component test: source='error' shows '—' in all four cards.
  - Manual: kill API, reload; no zeros presented as fact.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; avoids misleading pipeline totals.
- **Depends on:** GAP-CRM-DEALS-04

### GAP-CRM-DEALS-04  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Money is a JS number (parseMinor → Number) summed with reduce, contrary to the paise-bigint rule used by campaigns.ts; precision is safe only below 2^53 paise and the type invites float arithmetic (app/(app)/crm/deals/page.tsx:10, app/_data/apiMappers.ts:63).
- **Verified evidence:** amount is number: parseMinor (apiMappers.ts ~63) returns Number(); deals/page.tsx:10-11 sum with reduce. Sums of integer paise are exact below 2^53 (~9e13 rupees) so practical precision risk is nil; the valid point is type discipline (CLAUDE.md money=bigint minor). formatMoney (formatters.ts:90) already accepts bigint/string. The campaigns.ts comparison was not checked.
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/crm/deals/page.tsx`, `apps/web/src/app/(app)/crm/deals/DealsTable.tsx`
- **Fix steps:**
  1. Change DealSummary.amount to a minor-unit string and parse with BigInt in mapDealSummaries.
  2. Sum with BigInt in deals/page.tsx and pass to formatMoney.
  3. Update DealsTable Deal/DealRow types and DataTable amount cell (already formatMoney-based).
- **Acceptance:**
  - Unit test: sum of '9007199254740993' and '1' is exact.
  - Manual: totals unchanged for normal data.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Touches shared DealSummary type used by other pages; regression risk in money display.
- **Depends on:** GAP-CRM-DEALS-03

### GAP-CRM-DEALS-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The "Account" column shows contactName ?? company, i.e. usually a person, not an Account record, and does not link to /crm/accounts (app/(app)/crm/deals/DealsTable.tsx:48, app/_data/apiMappers.ts:523).
- **Verified evidence:** DealsTable.tsx:84 account: d.contactName ?? '—'; apiMappers.ts:523 contactName = row.contactName ?? row.company. Column labelled 'Account' (:126), no link. The row has contactId (mapper :522) and /crm/contacts/[id] exists.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/DealsTable.tsx`
- **Fix steps:**
  1. Rename column to 'Contact / Company'.
  2. Add contactId to DealRow and render a link to /crm/contacts/${contactId} (or an account link when an account id exists).
  3. Keep '—' when neither is set.
- **Acceptance:**
  - Manual: clicking the name opens the contact.
  - Component test: no link rendered when contactId missing.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-DEALS-NEW-07

### GAP-CRM-DEALS-06  ·  LOW  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** DealsTable defines an exportCsv() that writes the raw paise integer under a "Value" header but nothing calls it; the working export is DataTable's own. Dead code that would misstate values 100x if wired (app/(app)/crm/deals/DealsTable.tsx:54).
- **Verified evidence:** DealsTable.tsx:90-105 defines exportCsv() writing String(r.amount) raw paise under 'Value'; nothing references it (only DataTable's exportable at :135). DataTable's own export (DataTable.tsx:267-268) uses formatMoney. Line cited (54) is wrong.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/DealsTable.tsx`
- **Fix steps:**
  1. Delete exportCsv().
  2. Remove now-unused imports/vars if any.
- **Acceptance:**
  - Lint/typecheck passes with no unused function.
  - Manual: DataTable CSV button still exports formatted values.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-DEALS-07  ·  LOW  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The same object is "Deals" (route, hub, custom fields), "Engagements" (dashboard, page) and "Engagement/New Engagement" (buttons); close date and probability are mapped but never shown (app/(app)/crm/deals/DealsTable.tsx:74).
- **Verified evidence:** Naming inconsistency real: deals/page.tsx:16 'Vendor / Stakeholder Engagements', :20 '+ New Engagement', DealsTable.tsx:110 'Engagements'; crm/page.tsx:13 hub says 'Deals'; new page says 'New Deal'. closeDate and probability are mapped (apiMappers.ts:527-528) but DealsTable columns (:123-129) omit them. Cited line 74 is wrong.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/DealsTable.tsx`, `apps/web/src/app/(app)/crm/deals/page.tsx`
- **Fix steps:**
  1. Pick the canonical term and align hub, header, buttons, empty state.
  2. Add 'Expected close' (formatIndianDate) and 'Probability' columns to DealRow/columns.
- **Acceptance:**
  - Manual: columns visible and sortable.
  - Grep shows one term across CRM deals pages.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-DEALS-NEW-07


---
## /crm/deals/[id]  —  `crm/deals-detail.html`

- **Source:** `apps/web/src/app/(app)/crm/deals/[id]/page.tsx`
- **Design reference:** `redesign/crm/deals-detail.html`

### GAP-CRM-DEALS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The workflow list is index-based over [prospecting, proposal, negotiation, closed_won, closed_lost]; a lost deal has currentIdx 4, so 'Closed Won' is rendered as done and 'Closed Lost' as current — a lost deal appears to have passed through a win (page.tsx:25-26, 64-66).
- **Verified evidence:** deals/[id]/page.tsx:25-26 STAGES ends [...,'closed_won','closed_lost']; a lost deal has currentIdx 4 so i=3 'Closed Won' gets 'done' (65) and 'Closed Lost' 'cur'. normalizeDealStage (apiMappers.ts:499-500) yields closed_lost for lost.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/[id]/page.tsx`
- **Fix steps:**
  1. Build the step list from deal.status: open path ['prospecting','proposal','negotiation'] then a terminal step: 'Closed Won' if status==='won', 'Closed Lost' if 'lost', else 'Closed' as todo.
  2. Compute currentIdx on that list.
  3. Add non-colour cue (text 'Lost') for the terminal step.
- **Acceptance:**
  - Lost deal: Prospecting/Proposal/Negotiation done, Closed Lost current, no Closed Won entry.
  - Won deal: symmetrical; open deal unaffected.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display only but currently misleading in approvals context.

### GAP-CRM-DEALS-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** When the fetch fails the page shows the error badge plus 'Deal not found — This deal does not exist or has been removed', which reads as a deletion rather than an outage (page.tsx:14-15).
- **Verified evidence:** page.tsx:10-16 when !deal shows DataSourceBadge if source==='error' plus EmptyState 'Deal not found'. fetchJson (apiClient.ts:141-166) returns source:'error' for any non-ok response including 5xx/network, with status field, so outages read as deletion.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/[id]/page.tsx`
- **Fix steps:**
  1. If source==='error' && status!==404 render <RefreshErrorState error={toHumanError('load',{area:'this deal'})} backHref='/crm/deals'/> instead of EmptyState.
  2. Show 'Deal not found' only for 404 or source 'api' with null (use status from LoaderResult if exposed; else extend getDealById).
- **Acceptance:**
  - Mock 500 -> retry state; mock 404 -> not found; retry calls router.refresh.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-CRM-DEALS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme COPY (was LOADING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** error.tsx passes area='CRM [Id]' to RouteError, so the user-facing sentence is 'We couldn't open CRM [Id]' (deals/[id]/error.tsx:17).
- **Verified evidence:** deals/[id]/error.tsx:17 area='CRM [Id]'; RouteError.tsx:63 prints 'We couldn't open {area}.' giving 'We couldn't open CRM [Id]'.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/[id]/error.tsx`
- **Fix steps:**
  1. Set area='this deal' (backLabel 'Back to engagements').
  2. Grep other CRM [id] error.tsx for the same placeholder.
- **Acceptance:**
  - Message reads 'We couldn't open this deal.'
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-DEALS-DETAIL-05  ·  LOW  ·  confirmed  ·  theme NAVUX (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The Parties card duplicates Account and Owner already shown in Deal Details, and neither links to the account or contact record although contactId is available (page.tsx:49,53,73-78).
- **Verified evidence:** page.tsx:49,53 (Deal Details) and 75,76 (Parties) both show contactName and owner; both plain text. deal.contactId is passed to actions (38) so a link is possible; contactName falls back to company (apiMappers.ts:523) so it may be a company, not a contact.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/[id]/page.tsx`
- **Fix steps:**
  1. Delete the duplicate Parties card or replace with distinct data (contact link).
  2. Render contactName as <Link href={`/crm/contacts/${deal.contactId}`}> when contactId exists.
  3. Rename label 'Account' to 'Contact / Organisation'.
- **Acceptance:**
  - Only one place shows owner; contact links to its record.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-DEALS-DETAIL-06  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** (W2 2026-10-16: closed by #N, W2 crm: closed by #N)
- **First-pass claim:** Success and error text uses hard-coded hex colours (#047857 / #b42318) and English literals instead of tokens / next-intl (DealDetailActions.tsx:165-172); the page mixes 'Deal' (title) with 'Engagement' (list).
- **Verified evidence:** DealDetailActions.tsx:165 color '#047857', :170 '#b42318' hard-coded; messages are English literals; page title 'Deal ...' (page.tsx:31) vs list 'Engagements' (deals/page.tsx:16). CustomFieldsManager uses same hex (204-205) too.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/[id]/DealDetailActions.tsx`, `apps/web/src/app/(app)/crm/deals/[id]/page.tsx`
- **Fix steps:**
  1. Replace hex with CSS tokens (e.g. var(--success)/var(--danger) if defined in tokens.css) or a shared <InlineStatus> component.
  2. Move strings to next-intl.
  3. Retitle page 'Engagement ...'.
- **Acceptance:**
  - No hex literals in file; dark/HC theme colours apply.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-DEALS-DETAIL-07  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** A deal whose stage is not in STAGES gets currentIdx -1, so every workflow step shows as todo with no current marker (page.tsx:26).
- **Verified evidence:** page.tsx:26 indexOf returns -1 for stage not in STAGES. The real trigger is 'qualification': normalizeDealStage (apiMappers.ts:487,494) keeps 'qualification' as-is (in DEAL_STAGES) while STAGES omits it, so such deals show all steps 'todo'. Unknown strings map to 'prospecting' (501), so it is not general.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/[id]/page.tsx`
- **Fix steps:**
  1. Add 'qualification' to STAGES between prospecting and proposal, or map it to proposal consistently.
  2. Guard: if currentIdx<0 treat as 0 and show raw stage label.
- **Acceptance:**
  - Deal with stage qualification shows Qualification as current.
  - No all-todo state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-DEALS-DETAIL-01


---
## /crm/deals/new  —  `crm/deals-new.html`

- **Source:** `apps/web/src/app/(app)/crm/deals/new/page.tsx`
- **Design reference:** `redesign/crm/deals-new.html`

### GAP-CRM-DEALS-NEW-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Stage can be set to Won or Lost at creation with no reason and no confirmation, bypassing the governed close flow (POST /close with a required reason of at least 10 characters for lost) that DealDetailActions enforces (deals/new/page.tsx:11-17, deals/[id]/DealDetailActions.tsx:97-107).
- **Verified evidence:** deals/new/page.tsx:11-17 STAGES includes Won and Lost; select at :115-120 posts form.stage straight to POST v1/crm/deals (:68-79) with no dialog or reason. DealDetailActions.tsx:85-107 closes via ActionButton requireReason (lost adds minReasonLength=10) -> POST v1/crm/deals/:id/close {outcome,reason} (:40-46). Whether crm-service rejects Won/Lost on create is not verifiable (service absent from snapshot). maker!=checker is not applicable to a single-user create.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/new/page.tsx`
- **Fix steps:**
  1. Remove Won and Lost from STAGES in NewDealPage so a deal can only be created open (Lead/Proposal/Negotiation).
  2. Keep closing exclusively in DealDetailActions (POST /close with reason).
  3. If back-dated closed deals are a real need, instead add a ConfirmDialog (requireReason, minReasonLength 10) on submit when stage is Won/Lost and call create then /close in sequence.
  4. Backend: reject closed stages on POST /v1/crm/deals and emit the audit event from the close path only.
- **Acceptance:**
  - Component test: stage select on /crm/deals/new has no Won/Lost options.
  - Manual: create a deal, then close it from the detail page; the reason prompt appears and audit trail records it.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; removes an option. Confirm with product that no import/back-dating use case relies on it.
- **Depends on:** GAP-CRM-DEALS-NEW-02

### GAP-CRM-DEALS-NEW-02  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Stage vocabulary differs from the rest of the module: the form posts capitalised Lead/Proposal/…/Won/Lost while the list and detail use prospecting/proposal/negotiation/closed_won/closed_lost; 'Lead' has no counterpart (deals/new/page.tsx:11-17, app/_data/apiMappers.ts normalizeDealStage).
- **Verified evidence:** Form STAGES (deals/new/page.tsx:11-17) are capitalised Lead/Proposal/Negotiation/Won/Lost, while list/detail use prospecting/proposal/negotiation/closed_won/closed_lost. But normalizeDealStage (apiMappers.ts:489-502) explicitly maps lead->prospecting, won->closed_won, lost->closed_lost, and loaders.ts:2778-2783 states the real backend contract returns capitalised values. So 'Lead' does have a counterpart (prospecting) and the list renders correctly; the real gap is that the vocabulary is duplicated in three places and 'qualification' exists in the mapper but not the form.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/new/page.tsx`, `apps/web/src/app/_data/apiMappers.ts`
- **Fix steps:**
  1. Create a single DEAL_STAGES constant (value, label, canonical key) in lib/crm/ and import it in NewDealPage and apiMappers.normalizeDealStage.
  2. Decide with backend whether the API canonical form is capitalised or snake_case; send that form only.
  3. Drive the stage select options from the shared constant (and drop Won/Lost per NEW-01).
- **Acceptance:**
  - Unit test: every option value in the constant round-trips through normalizeDealStage to a valid DealSummary stage.
  - Manual: create a Proposal deal; it lists as stage 'proposal'.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; contract must be confirmed against crm-service, which is not in this snapshot.
- **Depends on:** GAP-CRM-DEALS-NEW-01

### GAP-CRM-DEALS-NEW-03  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Money is a JS Number times 100 rounded on the client from a step=1 input, so paise cannot be entered and large values lose precision above 2^53 paise; no lakh grouping or preview of the entered amount (page.tsx:65-66, 112).
- **Verified evidence:** page.tsx:65-66 does Number(form.value) then Math.round(rupees*100); input at :112 is type=number step=1 so browser validation blocks fractional rupees (paise cannot be typed) and the >2^53 concern (~90 trillion rupees) is not realistic. Real gaps: float math against the money rule, no lakh grouping or preview (no formatMoney under the field), and NaN silently becomes 0 (:66). The repo already has rupeesToMinorString in lib/money.ts:28, used by OpportunityForm.tsx:85.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/new/page.tsx`
- **Fix steps:**
  1. Replace Math.round(rupees*100) with rupeesToMinorString(form.value.trim()) from @/lib/money; block submit when it returns null.
  2. Set step="0.01" and inputMode="decimal" if paise entry is wanted.
  3. Show a live formatMoney(minor) preview under the Value input.
  4. Send valueMinor in the type the API expects (string minor as in OpportunityForm) after confirming the contract.
- **Acceptance:**
  - Unit test: '1234567.89' yields '123456789'; 'abc' blocks submit with an inline error.
  - Manual: typing 1234567 shows '₹12,34,567.00' preview.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Money field; verify wire type (number vs string) with backend zod schema before changing.
- **Depends on:** GAP-CRM-DEALS-NEW-05

### GAP-CRM-DEALS-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The contact picker swallows both a non-OK response and an exception with no message, and loads the full contact list into a single dropdown (unpaged, no search) (page.tsx:42-52, 124-129).
- **Verified evidence:** page.tsx:42-52: `if (!res.ok) return;` and `catch { /* ignore */ }` give no message; fetch v1/crm/contacts has no query/limit and options are rendered in one <select> (:124-129). Server-side default page size is not verifiable (crm-service absent), so the picker may silently truncate.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/new/page.tsx`
- **Fix steps:**
  1. Add a contactsError state; on !res.ok or exception show an inline message with Retry beside the select.
  2. Replace the <select> with the existing SmartCombobox (app/_components/SmartCombobox.tsx) querying v1/crm/contacts?search= with a small limit.
  3. Keep contact optional so a failed lookup does not block creation.
- **Acceptance:**
  - Component test: mocked 500 on contacts shows the error text and a Retry button.
  - Manual: with 500+ contacts, typing filters via server search.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; verify contacts endpoint supports search/limit.

### GAP-CRM-DEALS-NEW-05  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Probability is independent of stage: a deal can be saved as Won at 0% or Lead at 100% (page.tsx:27-31, 67).
- **Verified evidence:** Initial state stage 'Lead', probability '0' (page.tsx:25-32); probability is clamped 0-100 only (:67) and never tied to stage. Nothing stops Won at 0% or Lead at 100%; DealDetailActions confirm text says close sets probability 100/0, showing the intended rule. No zod schema at the form boundary; submit only disabled by busy.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/new/page.tsx`
- **Fix steps:**
  1. Add a zod schema (name min 1, valueMinor >=0, probability int 0-100, stage enum) and validate in submit(), showing field errors.
  2. Default probability from stage on change (Lead 10, Proposal 40, Negotiation 70 or per product) while remaining editable within the stage band.
  3. Reject closed stages (see NEW-01) so the Won/Lost mismatch cannot occur.
- **Acceptance:**
  - Unit test: schema rejects probability 150 and empty name.
  - Manual: changing stage updates the default probability.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; stage-to-probability defaults are a product decision.
- **Depends on:** GAP-CRM-DEALS-NEW-01

### GAP-CRM-DEALS-NEW-06  ·  LOW  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The API returns the new record but the page ignores it and redirects to the list after a fixed 600 ms timeout rather than to the new deal (page.tsx:81-83).
- **Verified evidence:** page.tsx:80-83: response body is not read; after toast it calls setTimeout(() => router.push('/crm/deals'), 600) with no cleanup on unmount. Whether POST returns the new id cannot be verified (crm-service absent; CLAUDE.md CQRS rule says writes return 202 with the new id).
- **Files to change:** `apps/web/src/app/(app)/crm/deals/new/page.tsx`
- **Fix steps:**
  1. Parse the response JSON (data.id) and router.push(`/crm/deals/${id}`) when present, else fall back to /crm/deals.
  2. Remove the setTimeout; navigate immediately and let the toast persist.
  3. Read-your-writes: rely on router.refresh() after push.
- **Acceptance:**
  - Component test: mocked 202 {data:{id:'d1'}} navigates to /crm/deals/d1.
  - Manual: created deal opens directly.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; needs the response shape confirmed.

### GAP-CRM-DEALS-NEW-07  ·  LOW  ·  partly  ·  theme I18N (was FABRICATED)

- [~] **Status** NEEDS OWNER DECISION — naming (Deal vs Engagement) and hex-colour tokens require a product decision before web changes can land
- **First-pass claim:** Copy calls the record 'Deal' (title, button) while the list page says 'Engagement'; the picker says 'Contact' where the list column says 'Account'; banners use hard-coded hex colours (page.tsx:95-101).
- **Verified evidence:** Copy mismatch is real: new page title 'New Deal' (page.tsx:93), button 'Create deal' (:141), 'Contact (optional)' (:123) versus list 'Vendor / Stakeholder Engagements', '+ New Engagement' (deals/page.tsx:16,20) and column 'Account' (DealsTable.tsx:126). Hard-coded hex at :95 (#ecfdf3) and :100 (#fef2f2, #b42318). Not fabricated data, so the FABRICATED tag is wrong.
- **Files to change:** `apps/web/src/app/(app)/crm/deals/new/page.tsx`
- **Fix steps:**
  1. Agree one noun (Engagement vs Deal) and apply it to route title, PageHeader, submit button, toast and messages (ideally via next-intl keys).
  2. Rename picker label to match the list column (see DEALS-05).
  3. Replace hex banners with token classes / a shared Alert or banner component.
- **Acceptance:**
  - Manual: search UI for 'Deal' vs 'Engagement' shows consistent term.
  - Dark-mode check: banners readable.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-DEALS-07, GAP-CRM-DEALS-05


---
## /crm/dedup-candidates  —  `crm/dedup-candidates.html`

- **Source:** `apps/web/src/app/(app)/crm/dedup-candidates/page.tsx`
- **Design reference:** `redesign/crm/dedup-candidates.html`

### GAP-CRM-DEDUP-CANDIDATES-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Full email and phone of both contacts are shown side by side to any CRM role with no masking or role gate, although the page's purpose only needs enough to recognise a match (DPDP data minimisation) (dedup-candidates/page.tsx:47-53, 119-125).
- **Verified evidence:** FIELDS (dedup-candidates/page.tsx:47-53) include email and phone; PairCard prints raw pair.left/right[key] via fmt (:119,125). No masking or role gate beyond the CRM layout roles; no <Masked> shared component exists (grep found only integration secret mask). NOTE: dedupCandidates.ts:4-21 says GET /v1/crm/contacts/dedup-candidates does not exist in crm-service, so the page currently always renders the error state; the issue is latent until the endpoint exists.
- **Files to change:** `apps/web/src/app/(app)/crm/dedup-candidates/page.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`
- **Fix steps:**
  1. Create ds/Masked.tsx: masks email (a***@d***.com) and phone (last 2-4 digits) by default with a Reveal button shown only for permitted roles.
  2. Use Masked for email/phone cells in PairCard; keep name/company clear.
  3. Reveal calls a backend audit endpoint (log who revealed which contact).
  4. Prefer backend returning masked values plus a match-reason list.
- **Acceptance:**
  - Component test: email/phone masked until Reveal; non-permitted role has no button.
  - Manual: reveal writes an audit event.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII/DPDP; reveal role list is a policy decision.

### GAP-CRM-DEDUP-CANDIDATES-02  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Merge is irreversible ('cannot be undone') yet always keeps the left contact and only backfills its empty fields; the reviewer cannot swap sides or choose per-field winners even though differing fields are highlighted (page.tsx:139, 296; lib/crm/dedupCandidates.ts:60-66).
- **Verified evidence:** Merge button 'Merge → keep left' (page.tsx:139), ConfirmDialog at :291-305 says 'cannot be undone' and has no reason; mergeDedupPair(left.id,right.id) (dedupCandidates.ts:67-73) posts {primaryId,duplicateId}; left is always primary and only empty fields backfilled (:61-66). No swap or per-field choice; backend carry-over rules (merge-consumer) not verifiable.
- **Files to change:** `apps/web/src/app/(app)/crm/dedup-candidates/page.tsx`, `apps/web/src/lib/crm/dedupCandidates.ts`
- **Fix steps:**
  1. Add a 'Swap' control on PairCard that exchanges left/right in state before merge.
  2. Add requireReason (minReasonLength 10) to the merge ConfirmDialog and send reason in the merge body (needs backend field).
  3. Per-field winner selection needs backend merge payload support; treat as follow-up.
  4. Ensure the merge emits an audit event with both ids.
- **Acceptance:**
  - Component test: Swap makes right the primary in the POST body.
  - Manual: merge without reason is blocked.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Irreversible data merge; keep confirm mandatory.

### GAP-CRM-DEDUP-CANDIDATES-03  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Dismiss pair' fires immediately with no confirmation or reason, and the pair 'will not surface again' (dedupCandidates.ts:75); a mis-click permanently hides a real duplicate (page.tsx:141-147, 180-191).
- **Verified evidence:** Dismiss button onClick calls onDismiss=handleDismiss (page.tsx:141-147,284) which immediately calls dismissDedupPair (:180-191) and removes the pair; no ConfirmDialog or reason. Endpoint PATCH .../dismiss does not exist in crm-service per dedupCandidates.ts:4-21.
- **Files to change:** `apps/web/src/app/(app)/crm/dedup-candidates/page.tsx`
- **Fix steps:**
  1. Route Dismiss through the existing ConfirmDialog with requireReason (optional short reason).
  2. Add a dismissTarget state mirroring mergeTarget.
  3. Send reason to the backend and record an audit event; consider an Undo toast.
- **Acceptance:**
  - Component test: clicking Dismiss opens the dialog and calls no API until confirmed.
  - Manual: cancel leaves pair.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; backend dismiss persistence must exist first.

### GAP-CRM-DEDUP-CANDIDATES-04  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W2 2026-10-16: closed by #TBD, W2 crm: closed by #54b744b6e)
- **W0-10 note:** review found the W0 tick partly — Client sort by confidence + min-confidence filter + total done (page.tsx:303-304,345), but no pagination: all visiblePairs rendered (page.tsx:392); no backend page/minConfidence/total params (dedup-routes.ts:143 limit only)
- **First-pass claim:** No pagination, filter or sort: every flagged pair is fetched and rendered as a full card, so a large queue becomes a very long page; there is also no way to sort by confidence (page.tsx:272-288, dedupCandidates.ts:52-57).
- **Verified evidence:** getDedupCandidates (dedupCandidates.ts:50-59) fetches one unpaged list; page.tsx:272-289 maps all pairs to cards in server order; no sort/filter/pagination controls. Endpoint itself is absent from the backend snapshot.
- **Files to change:** `apps/web/src/app/(app)/crm/dedup-candidates/page.tsx`, `apps/web/src/lib/crm/dedupCandidates.ts`
- **Fix steps:**
  1. Client-side: sort pairs by confidence desc by default and add a confidence filter.
  2. Backend: add page/limit/minConfidence params and total to the response; add pagination UI.
  3. Show total count in the header.
- **Acceptance:**
  - Unit test: pairs render highest confidence first.
  - Manual: page size limits DOM cards.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-CRM-DEDUP-CANDIDATES-05  ·  LOW  ·  confirmed  ·  theme STALE-COMMENT (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The file header documents PATCH /v1/crm/contacts/:leftId/merge {mergeIntoId} but the client calls POST /v1/crm/contacts/merge {primaryId, duplicateId} — stale comment (page.tsx:8; lib/crm/dedupCandidates.ts:68-70).
- **Verified evidence:** Header comment page.tsx:8 says PATCH /v1/crm/contacts/:leftId/merge {mergeIntoId}; dedupCandidates.ts:68-70 actually POSTs /v1/crm/contacts/merge {primaryId,duplicateId}.
- **Files to change:** `apps/web/src/app/(app)/crm/dedup-candidates/page.tsx`
- **Fix steps:**
  1. Update the header comment to POST /v1/crm/contacts/merge {primaryId,duplicateId} and note list/dismiss endpoints are not yet implemented.
- **Acceptance:**
  - Comment matches dedupCandidates.ts.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-DEDUP-CANDIDATES-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Highest confidence is rendered in red and lowest in green, so a 92% match reads as an alarm rather than 'very likely the same person'; colours also come from a scoped style block with hex values and prefers-color-scheme rather than tokens (page.tsx:322-324, 358-363).
- **Verified evidence:** confidenceClass (page.tsx:28-32) gives >=80 'conf-high' styled red (#b91c1c on #fef2f2, :322); <60 green (:324). STYLES block uses hex and @media (prefers-color-scheme:dark) (:358-363), so it ignores the app's manual dark toggle.
- **Files to change:** `apps/web/src/app/(app)/crm/dedup-candidates/page.tsx`
- **Fix steps:**
  1. Reverse semantics: high match = strong emphasis colour (e.g. brand/amber), and label text 'High match' as a non-colour cue.
  2. Replace hex with design tokens/classes and use the theme selector used by DarkModeToggle instead of prefers-color-scheme.
  3. Consider using ds/ConfidenceBar.
- **Acceptance:**
  - Manual: 92% shows 'High match' in the emphasis colour in both themes.
  - Toggle dark mode manually; colours follow.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-DEDUP-CANDIDATES-07  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Other dedup calls use 'v1/...' while this module uses a leading slash '/v1/...' with browserFetch; harmless if the client normalises, but inconsistent (dedupCandidates.ts:52,68,77).
- **Verified evidence:** dedupCandidates.ts:52,68,77 use leading-slash paths; dataQuality.ts uses 'v1/...'. browserFetch strips a leading slash (browserClient.ts:22), so it is functionally harmless.
- **Files to change:** `apps/web/src/lib/crm/dedupCandidates.ts`
- **Fix steps:**
  1. Drop the leading slashes to match the module convention.
- **Acceptance:**
  - Typecheck/tests pass; requests still hit /api/proxy/v1/...
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /crm/dedup-rules  —  `crm/dedup-rules.html`

- **Source:** `apps/web/src/app/(app)/crm/dedup-rules/page.tsx`
- **Design reference:** `redesign/crm/dedup-rules.html`

### GAP-CRM-DEDUP-RULES-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed load the editor renders the 'No matching rules yet' empty state with an enabled 'Save rules' button; the empty branch is not gated on source==='error', so saving from that view PUTs an empty rule set and can wipe the tenant's deduplication rules — contradicting the file header 'never fabricate an empty rule set as fact' (DedupRulesEditor.tsx:5-6, 137, 146-152, 235).
- **Verified evidence:** DedupRulesEditor.tsx: getDedupRules returns {data:[],source:'error'} (dataQuality.ts getDedupRules); the editor shows DataSourceBadge (:137) but still falls to `rules.length === 0` -> EmptyState 'No matching rules yet' (:146-151), with '+ Add rule' and 'Save rules' enabled only by busy (:233-237). save() PUTs {rules} (dataQuality.ts saveDedupRules) so an empty array can be sent, wiping the tenant rules if the backend accepts it. Header comment :5-6 promises otherwise. Backend behaviour on empty PUT not verifiable.
- **Files to change:** `apps/web/src/app/_components/crm/DedupRulesEditor.tsx`
- **Fix steps:**
  1. When source==='error' render the ds ErrorState with onRetry={() => load()} (RefreshErrorState only does router.refresh, which will not re-run this client fetch) instead of the table and buttons.
  2. Disable Save unless source==='api'.
  3. Block saving an empty rule list unless user confirms explicitly via ConfirmDialog.
  4. Backend: reject empty rules PUT or require confirm flag.
- **Acceptance:**
  - Component test: GET 500 shows error state, no Save button.
  - Component test: empty saved list requires confirm.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** High: silent wipe of dedup config.

### GAP-CRM-DEDUP-RULES-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Saving replaces the whole rule list (PUT {rules}) with no version or If-Match token and no change summary; two admins editing at once silently overwrite each other, and there is no dirty-state warning when leaving with unsaved edits (DedupRulesEditor.tsx:107-123; lib/crm/dataQuality.ts:192-198).
- **Verified evidence:** save() calls saveDedupRules(rules) -> PUT v1/crm/dedup-rules {rules} (dataQuality.ts) with no version/ETag; normaliseRules keeps no version field. No dirty-state tracking or beforeunload/route-change guard anywhere in the editor (no shared hook found). Last write wins. Backend concurrency support not verifiable.
- **Files to change:** `apps/web/src/app/_components/crm/DedupRulesEditor.tsx`, `apps/web/src/lib/crm/dataQuality.ts`
- **Fix steps:**
  1. Backend: return a version/ETag with GET and require If-Match on PUT (409 on mismatch).
  2. Store version in the editor and send it; on 409 show 'rules changed, reload'.
  3. Track dirty state (compare to loaded snapshot) and add a beforeunload + in-app navigation warning.
  4. Optionally show a diff summary before saving.
- **Acceptance:**
  - Component test: dirty edit then navigation prompts.
  - Integration: stale version PUT returns 409 and UI shows reload message.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Config overwrites affect tenant-wide dedup behaviour.

### GAP-CRM-DEDUP-RULES-03  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** (W2 2026-10-16: closed by #TBD, W2 crm: closed by #2530bf7be)
- **W0-10 note:** review found the W0 tick partly — duplicate-field validation (DedupRulesEditor.tsx:218-220) and default weight 50 (:168) done; fix step 3 / acceptance "removing then saving shows a summary" missing: no undo or removed-count summary (confirmEmpty at :93,226 only guards saving zero rules)
- **First-pass claim:** 'Remove' deletes the row immediately (local state) with no confirmation, and a new rule defaults to weight 1 (out of 100) so it has almost no effect until edited; nothing stops two rules on the same field (DedupRulesEditor.tsx:94-105).
- **Verified evidence:** removeRule (DedupRulesEditor.tsx:102-105) deletes locally with no confirm, but nothing is persisted until 'Save rules', so it is recoverable by reloading; addRule default weight 1 (:97) with threshold 90 is confirmed and duplicates of the same field are not checked (save only runs ruleNumbersValid, :110). A reason-dialog is overkill.
- **Files to change:** `apps/web/src/app/_components/crm/DedupRulesEditor.tsx`
- **Fix steps:**
  1. Add a duplicate-field/matchType validation in save() with inline error.
  2. Default new-rule weight to a meaningful value (e.g. 50) or show a required warning when weight < threshold semantics.
  3. Add a lightweight Undo or confirm-on-Save summary (removed N rules) instead of per-row dialog.
- **Acceptance:**
  - Unit test: two email/exact rules blocks save.
  - Manual: removing then saving shows a summary.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-DEDUP-RULES-02

### GAP-CRM-DEDUP-RULES-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Weight and threshold are unexplained bare numbers: no help text on how they combine, no total, and no preview of what a change does to the flagged-pair count (DedupRulesEditor.tsx:158-159, 189-210).
- **Verified evidence:** Table headers 'Weight' and 'Threshold' (DedupRulesEditor.tsx:158-159) and number inputs (:189-210) have only sr-only labels; no help text, sum of weights, or impact preview. Preview needs backend support (dry-run count).
- **Files to change:** `apps/web/src/app/_components/crm/DedupRulesEditor.tsx`
- **Fix steps:**
  1. Add HelpTip/Term (ds) on Weight and Threshold headers explaining scoring.
  2. Show total of enabled weights under the table.
  3. Optional: backend dry-run endpoint returning flagged-pair count; display before Save.
- **Acceptance:**
  - Manual: tooltips read correctly with keyboard.
  - Total updates when weights change.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-DEDUP-RULES-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** ALLOWED_ROLES includes 'admin' and 'tenant_admin', but the parent CRM layout already requires crm_user, crm_admin, platform_admin or super_admin, so those two roles cannot reach the page unless they also hold a CRM role (dedup-rules/layout.tsx:8; crm/layout.tsx:5).
- **Verified evidence:** dedup-rules/layout.tsx:8 ALLOWED_ROLES includes admin and tenant_admin; crm/layout.tsx:5,8 requires one of crm_user, crm_admin, platform_admin, super_admin (requireAnyRole in lib/auth/roleGuard.ts redirects otherwise), so admin/tenant_admin without a CRM role never reach it.
- **Files to change:** `apps/web/src/app/(app)/crm/dedup-rules/layout.tsx`, `apps/web/src/app/(app)/crm/layout.tsx`
- **Fix steps:**
  1. Decide whether tenant admins should reach CRM: if yes add admin/tenant_admin to CRM_ROLES; if no drop them from ALLOWED_ROLES.
- **Acceptance:**
  - Unit test with each role asserts redirect/allow.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Access control change; needs security sign-off.

### GAP-CRM-DEDUP-RULES-06  ·  LOW  ·  partly  ·  theme I18N (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Success and error messages use hard-coded hex colours and English literals; field values render as raw enum text ('gstin', 'exact') (DedupRulesEditor.tsx:140-143, 175, 186).
- **Verified evidence:** Hard-coded hex at DedupRulesEditor.tsx:140 (#047857) and :143 (#b42318); English literals throughout; option values render raw enum text 'gstin'/'exact' (:175,186). Not fabricated data so FABRICATED tag is wrong. Icon is an emoji (:148).
- **Files to change:** `apps/web/src/app/_components/crm/DedupRulesEditor.tsx`
- **Fix steps:**
  1. Add FIELD_LABELS/MATCH_LABELS maps (e.g. gstin->'GSTIN', exact->'Exact match') used for option text.
  2. Replace inline hex with token classes or a shared alert component.
  3. Move strings to next-intl keys.
- **Acceptance:**
  - Manual: options read 'GSTIN', 'Exact'.
  - Dark mode message colours readable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /crm/document-types  —  `crm/document-types.html`

- **Source:** `apps/web/src/app/(app)/crm/document-types/page.tsx`
- **Design reference:** `redesign/crm/document-types.html`

### GAP-CRM-DOCUMENT-TYPES-02  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** A type can be saved with no 'Applies to' box ticked, and 'Mandatory' with none selected means it applies to nothing; no validation or hint (editor:318-320, 409-415).
- **Verified evidence:** apps/web/src/app/_components/crm/DocumentTypesEditor.tsx:77-79 rowValid() checks only code and name; save() (81-109) sends appliesTo unchecked; Applies-to checkboxes at 165-175 and Mandatory at 177-180 have no hint. Editor uses no zod (CLAUDE.md rule 9 applies to services; web-side form validation is plain code). Disable-while-busy already exists (line 195). What an empty appliesTo means to the backend cannot be verified (crm-service absent from snapshot).
- **Files to change:** `apps/web/src/app/_components/crm/DocumentTypesEditor.tsx`
- **Fix steps:**
  1. Add a zod schema documentTypeSchema in apps/web/src/lib/crm/documents.ts (code, name min 1, appliesTo min 1 of SUBJECT_TYPES, mandatory implies appliesTo non-empty) and use safeParse in rowValid/save.
  2. Show per-field inline error under the Applies-to fieldset (aria-describedby, role=alert) once the row is touched.
  3. Disable Save while the schema fails and show helper text 'Select at least one record type'.
  4. Add hint under Mandatory: 'Flags a missing document on every record of the selected types'.
  5. Confirm with backend whether empty appliesTo means 'all' before choosing to block vs. warn.
- **Acceptance:**
  - Unit: schema rejects appliesTo=[]; accepts one type.
  - Manual: untick all Applies-to boxes, Save is disabled and message shows; tick one, Save enables.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; risk is blocking types that legitimately mean 'all records' if backend treats empty as all - confirm first.

### GAP-CRM-DOCUMENT-TYPES-03  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Delete confirmation says the type 'will no longer be selectable for new uploads' but does not say whether existing documents of that type are kept, nor show how many exist (editor:459-461).
- **Verified evidence:** apps/web/src/app/_components/crm/DocumentTypesEditor.tsx:216-225 ConfirmDialog description is only '“name” will no longer be selectable for new uploads.'; no reason field, no count, no statement about existing documents. Lines cited (459-461) are wrong. deleteDocumentType(id) at lib/crm/documents.ts:402 takes only id. Count of existing documents or reason support needs a crm-service endpoint (absent from snapshot).
- **Files to change:** `apps/web/src/app/_components/crm/DocumentTypesEditor.tsx`, `apps/web/src/lib/crm/documents.ts`
- **Fix steps:**
  1. Confirm with backend whether delete is soft (existing docs keep type) and whether a usage-count is available; do not invent an endpoint.
  2. Once known, extend the ConfirmDialog description to state the outcome for existing documents (e.g. 'N documents keep this type').
  3. If ConfirmDialog supports a reason field, require it and pass to deleteDocumentType(id, reason); otherwise add prop to ds ConfirmDialog.
  4. Ensure server emits an audit event for delete (CLAUDE.md rule 8).
- **Acceptance:**
  - Manual: open Delete for a type in use; dialog states impact on existing documents.
  - Test: Confirm disabled until reason entered (if adopted).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Data governance; deleting a mandatory type silently changes compliance flags on records.

### GAP-CRM-DOCUMENT-TYPES-04  ·  LOW  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** On failed load the DataSourceBadge is shown twice, in the card header and again inline (editor:378, 388).
- **Verified evidence:** apps/web/src/app/_components/crm/DocumentTypesEditor.tsx:137 renders DataSourceBadge in card header when source==='error' and line 147 renders it again inside the unavailable message. Line numbers in the observation (378, 388) are wrong. Note the error state does correctly avoid an empty list (145-148) and hides Add (207).
- **Files to change:** `apps/web/src/app/_components/crm/DocumentTypesEditor.tsx`
- **Fix steps:**
  1. Remove the inline DataSourceBadge at line 147 (keep header badge).
  2. Replace the <p role=alert> at 146-148 with RefreshErrorState (ds/RefreshErrorState.tsx) or a Retry button calling load(), since router.refresh does not re-run this client fetch.
- **Acceptance:**
  - Manual: force 500 on GET /v1/crm/document-types; exactly one badge is shown plus a retry action.
  - Clicking Retry re-fetches and renders the list.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-DOCUMENT-TYPES-05  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 closed by #1860, verified on main 9c5e9e9e9; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** loading.tsx renders a heading plus four 80px tiles and a 280px block, but the loaded page has no tiles and a different card list, so the layout jumps on load (document-types/loading.tsx:1-19).
- **Verified evidence:** document-types/loading.tsx:9-16 renders 4 tiles (80px) and a 280px block; the real page (page.tsx + apps/web/src/app/_components/crm/DocumentTypesEditor.tsx) is a header plus a card of stacked li rows with no tiles. Also loading.tsx duplicates the heading via its own .ph h1 while the loaded page uses PageHeader (harmless as they replace each other but structures differ). The same copy-pasted skeleton is used in documents/ and escalation-rules/.
- **Files to change:** `apps/web/src/app/(app)/crm/document-types/loading.tsx`
- **Fix steps:**
  1. Replace tile grid with a single card skeleton containing 3 stacked ~180px row blocks matching the li layout.
  2. Use PageHeader-compatible markup (same title, subtitle placeholder) so the header does not jump.
  3. Keep animate-pulse and aria-busy; use var(--line2) tokens rather than #f1f5f9.
- **Acceptance:**
  - Manual: throttle network; skeleton shows no tiles and heights approximate loaded layout (CLS near 0).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CRM-DOCUMENTS-04, GAP-CRM-ESCALATION-RULES-06

### GAP-CRM-DOCUMENT-TYPES-06  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Card rows use a fixed 1fr/2fr grid and inline 36-40px controls with no responsive rule, and each row saves independently so edits to several rows can be lost when one Save reloads the list via load() (editor:396, 344).
- **Verified evidence:** True: apps/web/src/app/_components/crm/DocumentTypesEditor.tsx:155 uses gridTemplateColumns '1fr 2fr' with no breakpoint; and save() line 103 calls load() which sets source='loading' (line 48), which swaps the whole list for the loading text (143-144) and then setRows replaces every row, so unsaved edits/new rows in other cards are lost. Not a defect: controls are 36px inputs (inputStyle) and 40px Buttons, which are acceptable sizes. Line refs 396/344 wrong.
- **Files to change:** `apps/web/src/app/_components/crm/DocumentTypesEditor.tsx`
- **Fix steps:**
  1. In save()/doDelete() replace await load() with a merge: update only the saved row (from the response or a refetch) and keep other rows' local state.
  2. Do not set source='loading' on refresh; use a separate 'refreshing' flag.
  3. Change the code/name grid to repeat(auto-fit,minmax(200px,1fr)) or a class with a mobile breakpoint.
  4. Optionally mark dirty rows with an 'Unsaved changes' label.
- **Acceptance:**
  - Test: edit row B, save row A; row B edit is still present.
  - Manual at 375px width: Code and Name stack vertically.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; ensure created rows get the server id/key so they don't duplicate.

### GAP-CRM-DOCUMENT-TYPES-07  ·  LOW  ·  partly  ·  theme I18N (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** All copy is hard-coded English with hex colours for status text; subject labels come from SUBJECT_TYPE_LABELS (lib/crm/documents.ts:72-79).
- **Verified evidence:** All UI copy in apps/web/src/app/_components/crm/DocumentTypesEditor.tsx is hard-coded English and success/error colours are literal hex (#047857 line 140, #b42318 line 141). SUBJECT_TYPE_LABELS is at apps/web/src/lib/crm/documents.ts:68-75, not 72-79. The suite shows no i18n runtime in web/src/lib for CRM (only lib/payroll/statusLabels.ts label map), so 'hard-coded English' is the codebase norm, not a page-specific defect. Hex colours are real.
- **Files to change:** `apps/web/src/app/_components/crm/DocumentTypesEditor.tsx`
- **Fix steps:**
  1. Replace #047857/#b42318 with existing status tokens (e.g. var(--ok)/var(--danger); confirm token names in civitas-ds.css).
  2. Optionally extract copy strings to a lib/crm/messages map if the team adopts i18n; otherwise close as won't-fix.
- **Acceptance:**
  - Visual: success/error messages render identically in light and dark themes using tokens.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /crm/documents  —  `crm/documents.html`

- **Source:** `apps/web/src/app/(app)/crm/documents/page.tsx`
- **Design reference:** `redesign/crm/documents.html`

### GAP-CRM-DOCUMENTS-01  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Manage Document Types' is rendered as the primary action for every CRM role, but /crm/document-types is admin-only (layout requireAnyRole with redirect to /crm), so a clerk clicks the main button and is bounced back (documents/page.tsx:34; document-types/layout.tsx:11-14).
- **Verified evidence:** documents/page.tsx:34 renders <a className='btn primary' href='/crm/document-types'> for everyone; document-types/layout.tsx:11-14 uses requireAnyRole(['crm_admin','admin','super_admin','platform_admin','tenant_admin'],'/crm'), which redirects others to /crm. The page is a server component and roleGuard.ts exposes getSessionRoles() usable to gate the button.
- **Files to change:** `apps/web/src/app/(app)/crm/documents/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. Export the ALLOWED_ROLES constant (e.g. CRM_ADMIN_ROLES in lib/auth/roleGuard.ts) and reuse it in document-types/layout.tsx.
  2. In documents/page.tsx call getSessionRoles(), compute canManage, and render the Manage button and the list-item link only if true.
  3. For non-admins, show plain text 'Ask a CRM administrator to change document types'.
- **Acceptance:**
  - Test: as crm_user the Manage button is absent; as crm_admin it is present and navigates.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; UI hiding only, route guard remains the enforcement.

### GAP-CRM-DOCUMENTS-02  ·  MEDIUM  ·  partly  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The route is a dead-end explainer: there is no cross-record document list, no search by scan status, missing-mandatory or expiring documents, even though the copy describes exactly those states; a clerk cannot see what is expiring without opening each record (page.tsx:12-37).
- **Verified evidence:** documents/page.tsx:9-37 is indeed a static explainer with links to accounts/contacts/document-types; no list, filter or search. Copy (28) says panels flag missing/expiring docs per record. lib/crm/documents.ts exports only per-subject getDocuments(subjectType, subjectId) (304); no cross-record listing endpoint is visible and crm-service is absent, so a cross-record list is a new backend capability. Overstated only in that per-record flags do exist.
- **Files to change:** `apps/web/src/app/(app)/crm/documents/page.tsx`, `apps/web/src/lib/crm/documents.ts`
- **Fix steps:**
  1. Decide scope with product: cross-record document register (filter by scanStatus, missing-mandatory, expiring<=30d).
  2. Backend: add a paged list endpoint with those filters (do not assume one exists).
  3. Web: add getDocumentRegister() loader + DataTable with filters and LoadErrorState, linking each row to its subject record.
  4. Until then, reword subtitle to say documents are managed per record.
- **Acceptance:**
  - Manual: filter 'Expiring in 30 days' lists only documents expiring; row links to its record.
  - Failed load shows error state, not empty table.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Scope creep; must respect record-level access when aggregating.

### GAP-CRM-DOCUMENTS-03  ·  LOW  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** All links are plain anchor tags instead of next/link, forcing full page loads inside the app shell (page.tsx:27, 32-34).
- **Verified evidence:** documents/page.tsx uses <a href> at lines 27, 32, 33, 34 for internal routes, causing full document loads. The same pattern (<a className='btn'>) is used in forecast/page.tsx:28 and StageBreakdownTable.tsx:66, so it is systemic.
- **Files to change:** `apps/web/src/app/(app)/crm/documents/page.tsx`, `apps/web/src/app/(app)/crm/forecast/page.tsx`, `apps/web/src/app/(app)/crm/forecast/StageBreakdownTable.tsx`
- **Fix steps:**
  1. Import Link from 'next/link' and replace the four anchors, keeping className.
  2. Apply the same to forecast page.tsx:28 and StageBreakdownTable emptyAction.
  3. Consider a lint rule (@next/next/no-html-link-for-pages) to catch this.
- **Acceptance:**
  - Manual: clicking 'Go to Accounts' does not trigger a full reload (network shows RSC payload only).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-DOCUMENTS-04  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 closed by #1860, verified on main 9c5e9e9e9; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** loading.tsx draws four stat tiles and a 280px block for a page that has neither, and titles itself 'Documents' with its own h1 (documents/loading.tsx).
- **Verified evidence:** documents/loading.tsx:9-16 has 4 tiles + 280px block while the page is a single text card (page.tsx:18-37). The 'own h1 titled Documents' is not a real conflict: loading replaces the page during Suspense and its title matches; it just omits the subtitle/back link.
- **Files to change:** `apps/web/src/app/(app)/crm/documents/loading.tsx`
- **Fix steps:**
  1. Drop the tile grid; render one card skeleton with 3 text lines and a button row.
  2. Match PageHeader structure incl. subtitle line.
- **Acceptance:**
  - Manual: throttle network; no tile flash before the single card.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CRM-DOCUMENT-TYPES-05


---
## /crm/escalation-rules  —  `crm/escalation-rules.html`

- **Source:** `apps/web/src/app/(app)/crm/escalation-rules/page.tsx`
- **Design reference:** `redesign/crm/escalation-rules.html`

### GAP-CRM-ESCALATION-RULES-01  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Recipient user is a free-text raw user id ('user id (optional)') and recipient role a free-text string ('e.g. sales_manager'); there is no picker or validation against real users/roles, so a typo saves and leads escalate to nobody (EscalationRulesEditor.tsx:200-205).
- **Verified evidence:** apps/web/src/app/_components/crm/EscalationRulesEditor.tsx:198-205 recipientRole is free text (placeholder 'e.g. sales_manager') and recipientId free text ('user id (optional)'); rowValid (38-44) only requires one to be non-empty. No lookup exists. Whether backend validates ids/roles cannot be verified (crm-service absent).
- **Files to change:** `apps/web/src/app/_components/crm/EscalationRulesEditor.tsx`, `apps/web/src/lib/crm/assignment.ts`
- **Fix steps:**
  1. Replace role input with a select populated from the tenant's role list and user input with a user picker (reuse an existing user/role lookup component in ds if one exists; otherwise confirm the endpoint with backend).
  2. Validate in rowValid that selected values come from the loaded lists.
  3. Show recipient name instead of raw id in read state.
  4. Backend to reject unknown role/user with 422 and surface via error message.
- **Acceptance:**
  - Test: unknown role string cannot be saved.
  - Manual: choose a user from picker; saved rule shows user name.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Rules pointing at nobody mean lead SLA breaches go unescalated.

### GAP-CRM-ESCALATION-RULES-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed load the badge appears but the table area shows 'No escalation rules yet', presenting an outage as an empty configuration (editor:145-156).
- **Verified evidence:** apps/web/src/app/_components/crm/EscalationRulesEditor.tsx:145 shows the badge when source==='error', but rows is [] (assignment.ts:388 returns data []) so lines 150-155 render EmptyState 'No escalation rules yet' and 235-237 still offers '+ Add escalation rule'. Contradicts the file's own header comment (7-8).
- **Files to change:** `apps/web/src/app/_components/crm/EscalationRulesEditor.tsx`
- **Fix steps:**
  1. When source==='error' render RefreshErrorState/Retry button (calls load()) instead of the table/EmptyState.
  2. Hide the Add button in error state (as DocumentTypesEditor does at line 207).
  3. Keep header badge.
- **Acceptance:**
  - Manual: force 500 on GET v1/crm/escalation-rules; page shows 'could not load' with Retry, no empty-state and no Add button.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Adding rules on top of an unloaded set could create duplicates; hiding Add mitigates.
- **Depends on:** GAP-CRM-FORECAST-01

### GAP-CRM-ESCALATION-RULES-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Saving one row calls load(), which replaces all rows from the server and discards unsaved edits in the other rows; new unsaved rows disappear too (editor:100-103).
- **Verified evidence:** apps/web/src/app/_components/crm/EscalationRulesEditor.tsx:103 calls load() after save; load() (57-63) sets source='loading' and the component returns early at 131-137, unmounting the table, then setRows(data.map(toRow)) replaces every row. Unsaved edits and unsaved new rows in other rows are discarded. Same at delete (123).
- **Files to change:** `apps/web/src/app/_components/crm/EscalationRulesEditor.tsx`
- **Fix steps:**
  1. Split loading into initial 'loading' vs 'refreshing' so the table stays mounted.
  2. After save/delete update only the affected row (or merge server rows by id, preserving rows with key starting 'new-' and dirty edits).
  3. Track dirty state per row and show 'Unsaved' marker.
- **Acceptance:**
  - Test: edit row 2, save row 1, row 2 edit persists.
  - Add new unsaved row, save another; new row still present.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; make sure a just-created row does not duplicate.
- **Depends on:** GAP-CRM-DOCUMENT-TYPES-06

### GAP-CRM-ESCALATION-RULES-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Threshold is only in minutes (a day is 1440) with no unit switch or humanised preview; 'Reassign' is a bare Yes/No with no explanation of who receives the lead (editor:161, 164, 207-210).
- **Verified evidence:** apps/web/src/app/_components/crm/EscalationRulesEditor.tsx:161 header 'Threshold (min)', input type=number in minutes (191) with no unit or preview; 'Reassign' is a checkbox with Yes/No text (207-210) and no help text on who receives the lead.
- **Files to change:** `apps/web/src/app/_components/crm/EscalationRulesEditor.tsx`
- **Fix steps:**
  1. Add unit select (minutes/hours/days) converting to thresholdMinutes on change, plus humanised preview ('= 1 day').
  2. Add helper/tooltip on Reassign: reassigns to the recipient role/user (confirm actual behaviour with backend before wording).
  3. Keep stored value in minutes.
- **Acceptance:**
  - Test: 1 day input stores 1440.
  - Manual: preview shows '1 day 2 hours' for 1560.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Wrong helper wording could misstate reassignment behaviour; verify with service owner.

### GAP-CRM-ESCALATION-RULES-05  ·  LOW  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Nothing stops duplicate rules for the same trigger and threshold, and there is no ordering or precedence shown when several rules match (editor:75-80).
- **Verified evidence:** apps/web/src/app/_components/crm/EscalationRulesEditor.tsx:75-80 addRule defaults to trigger 'unaccepted', 60 min, and rowValid (38-44) has no duplicate check; no ordering column or precedence note in the table (157-232). Whether backend enforces uniqueness cannot be verified.
- **Files to change:** `apps/web/src/app/_components/crm/EscalationRulesEditor.tsx`
- **Fix steps:**
  1. Add a duplicate check in saveRow on (trigger, thresholdMinutes, recipientRole, recipientId) against current rows and block with message.
  2. Sort rows by trigger then threshold and add a note explaining how multiple matching rules fire (confirm with backend).
  3. Backend: add unique constraint or 409 response.
- **Acceptance:**
  - Test: two identical rules; second Save is rejected.
  - Manual: rows are displayed sorted by trigger and threshold.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Duplicate rules may send duplicate notifications.

### GAP-CRM-ESCALATION-RULES-06  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx shows four stat tiles and a 280px block under its own h1 although the page has neither; the table is a seven-column grid with no mobile transform (escalation-rules/loading.tsx; editor:157-168).
- **Verified evidence:** escalation-rules/loading.tsx:9-16 has 4 tiles + 280px block; page has none (confirmed). The table at apps/web/src/app/_components/crm/EscalationRulesEditor.tsx:157 is a real <table className='tbl'> with 7 columns and inline inputs, NOT wrapped in .tbl-wrap (civitas-ds.css:132 gives overflow-x:auto only to the wrapper), so on mobile it overflows the card; no stacked transform. 'Seven-column grid' wording is inaccurate.
- **Files to change:** `apps/web/src/app/_components/crm/EscalationRulesEditor.tsx`, `apps/web/src/app/(app)/crm/escalation-rules/loading.tsx`
- **Fix steps:**
  1. Wrap the table in <div className='tbl-wrap'> for horizontal scroll.
  2. Optionally add a stacked card layout under 640px.
  3. Replace loading tiles with a card+table-row skeleton.
- **Acceptance:**
  - Manual at 375px: table scrolls horizontally inside the card, no page overflow.
  - Skeleton has no tiles.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CRM-DOCUMENT-TYPES-05

### GAP-CRM-ESCALATION-RULES-07  ·  LOW  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Two similarly named admin routes exist for escalation (this lead escalation and /crm/task-escalation for tasks); the page title and subtitle do not say 'lead' in the heading (page.tsx:9).
- **Verified evidence:** page.tsx:9-10 title is 'Escalation Rules' but the subtitle explicitly says 'Escalate leads...', so the subtitle does mention leads; the title alone is ambiguous. A sibling route apps/web/src/app/(app)/crm/task-escalation exists (verified by listing), so ambiguity is real but smaller than described.
- **Files to change:** `apps/web/src/app/(app)/crm/escalation-rules/page.tsx`, `apps/web/src/app/(app)/crm/escalation-rules/error.tsx`, `apps/web/src/app/(app)/crm/escalation-rules/loading.tsx`
- **Fix steps:**
  1. Retitle to 'Lead Escalation Rules' in page.tsx, loading.tsx and error area; update hub link label.
  2. Add cross-link to /crm/task-escalation in the subtitle.
- **Acceptance:**
  - Manual: title reads 'Lead Escalation Rules' on page and skeleton.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /crm/forecast  —  `crm/forecast.html`

- **Source:** `apps/web/src/app/(app)/crm/forecast/page.tsx`
- **Design reference:** `redesign/crm/forecast.html`

### GAP-CRM-FORECAST-01  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed load the badge is shown but the tiles print ₹0.00 / 0 and the table says 'No forecast yet'; unlike Grievances / Lead Forms there is no '—' guard, so an outage reads as a genuinely empty pipeline (page.tsx:18, 30-56; StageBreakdownTable.tsx:63-66).
- **Verified evidence:** apps/web/src/app/(app)/crm/forecast/page.tsx:18 sets source='error'; line 30 shows only the badge; lines 31-56 still render StatCards with formatMoney('0') (= ₹0.00), '0' deals and '—' top stage; StageBreakdownTable.tsx:63-66 shows 'No forecast yet'. Loader falls back to CRM_FORECAST_EMPTY (loaders.ts:3017). LoaderResult carries status/errorMessage so LoadErrorState (ds) is usable.
- **Files to change:** `apps/web/src/app/(app)/crm/forecast/page.tsx`
- **Fix steps:**
  1. Import LoadErrorState from ds and, when forecastSource==='error', return it (area 'forecast', backHref '/crm') in place of tiles and table.
  2. If only pipelines failed, render the forecast and a small inline notice about the filter.
  3. Alternatively pass '—' to StatCards when errored.
- **Acceptance:**
  - Manual: force 500 on /api/v1/crm/forecast; page shows error state with retry, no ₹0.00.
  - Test: healthy empty forecast still renders zeros and 'No forecast yet'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Money display: showing ₹0.00 during outage misleads pipeline reviews.
- **Depends on:** GAP-CRM-ESCALATION-RULES-02

### GAP-CRM-FORECAST-02  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The Pipeline filter component returns null when the pipeline list is empty, so a failed pipelines fetch silently removes the filter with no message while the forecast still renders (PipelineFilter.tsx:21; page.tsx:15-18).
- **Verified evidence:** PipelineFilter.tsx:21 returns null for an empty list and page.tsx:15-18 derives pipelines from getPipelines() whose error fallback is []. But line 18 folds pipelineSource into source, so line 30 does show the badge when the pipelines fetch fails; it is not fully silent, just non-specific.
- **Files to change:** `apps/web/src/app/(app)/crm/forecast/page.tsx`, `apps/web/src/app/(app)/crm/forecast/PipelineFilter.tsx`
- **Fix steps:**
  1. Pass a pipelinesFailed prop; render a disabled select with 'Pipelines unavailable' instead of null.
  2. Show explicit message when pipelines list is genuinely empty.
- **Acceptance:**
  - Manual: force 500 on pipelines; filter area shows disabled control with message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CRM-FORECAST-01

### GAP-CRM-FORECAST-03  ·  MEDIUM  ·  partly  ·  theme FILTER (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** A forecast with no time horizon: the page has no period, close-date or owner filter and forecast.ts models only totals and stages, so 'Weighted Forecast' cannot be tied to a quarter or financial year for the department (page.tsx:31-58; forecast.ts:8-16).
- **Verified evidence:** No period/close-date/owner filter: page searchParams only has pipelineId (page.tsx:9-11) and getCrmForecast(pipelineId) sends only that query param (loaders.ts:3040-3048); forecast.ts:10-16 models totals/stages only. Whether the forecast endpoint supports period/owner params cannot be verified (crm-service absent). Theme is not DATEFMT.
- **Files to change:** `apps/web/src/app/(app)/crm/forecast/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/crm/forecast/PipelineFilter.tsx`
- **Fix steps:**
  1. Confirm with backend which query params exist (period/closeDateFrom/To/owner).
  2. Extend crmForecastSchema and getCrmForecast to pass them; add period select (FY quarters) alongside PipelineFilter.
  3. Show the applied period in the header/subtitle regardless.
- **Acceptance:**
  - Manual: choose FY Q2; total changes and subtitle shows the period.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Money figure can be misread without a stated horizon.

### GAP-CRM-FORECAST-05  ·  LOW  ·  partly  ·  theme CLARITY (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Share of Forecast is rounded to two decimals per row and may not add to 100.00; probability bands (30 / 70) are hard-coded and not shown to the user (forecast.ts:43-47; StageBreakdownTable.tsx:56).
- **Verified evidence:** forecast.ts:24-36 computes share via bigint floor division then /100, so rows are truncated (never rounded up) and their sum is <= 100.00, possibly 99.9x; it cannot exceed 100. Probability bands at forecast.ts:44-45 (>=70 high, >=30 medium) are hard-coded and only shown as labels Likely/Possible/Early (StageBreakdownTable.tsx:15-19, 38) without thresholds. Theme is not FABRICATED.
- **Files to change:** `apps/web/src/app/(app)/crm/forecast/forecast.ts`, `apps/web/src/app/(app)/crm/forecast/StageBreakdownTable.tsx`
- **Fix steps:**
  1. Add a footnote/tooltip 'Likely >=70%, Possible 30-69%, Early <30%' generated from exported constants.
  2. Add footnote 'Shares are truncated to 2 decimals and may total slightly under 100%' or use largest-remainder rounding.
  3. Export band thresholds from forecast.ts and reuse.
- **Acceptance:**
  - Test: shares for 1/3,1/3,1/3 sum 99.99 and footnote is visible.
  - Manual: legend shows thresholds.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-FORECAST-06  ·  LOW  ·  partly  ·  theme CONSISTENCY (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Engagements' here, 'Deals' in the route and hub, and 'Engagement Board' for /crm/pipeline; stat icons are glyph characters on hard-coded hex backgrounds (#dcfce7, #e0f2fe, #fef3c7, #fce7f3) instead of tokens (page.tsx:32-55).
- **Verified evidence:** Hex icon backgrounds confirmed at page.tsx:34,40,46,52 (#dcfce7,#e0f2fe,#fef3c7,#fce7f3) and glyph-character icons; StatCard defaults iconBg to #eef2ff (ds/StatCard.tsx:32). Terminology drift is real: page.tsx labels say 'Engagements', crm/page.tsx:13 titles the route 'Deals' (description 'Engagements and procurement opportunities'), page.tsx:28 link says 'Engagement Board' to /crm/pipeline, and empty action is '+ New Engagement' to /crm/deals/new. Not a fabrication issue.
- **Files to change:** `apps/web/src/app/(app)/crm/forecast/page.tsx`, `apps/web/src/app/(app)/crm/page.tsx`, `apps/web/src/app/_components/ds/StatCard.tsx`
- **Fix steps:**
  1. Decide one term (Engagement vs Deal) and align hub label, route breadcrumb, page copy.
  2. Replace hex iconBg values with ds tone tokens (add tone prop to StatCard if needed).
  3. Swap glyph text icons for the ds icon set.
- **Acceptance:**
  - Visual: stat icons follow theme in dark mode.
  - Grep shows one term used across CRM hub and forecast.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /crm/grievances  —  `crm/grievances.html`

- **Source:** `apps/web/src/app/(app)/crm/grievances/page.tsx`
- **Design reference:** `redesign/crm/grievances.html`

### GAP-CRM-GRIEVANCES-01  ·  HIGH  ·  confirmed  ·  theme PAGINATION (was FAILMASK)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The loader requests limit=50&page=1 and the page never passes a page param nor renders pagination; the DataTable's 15-per-page pager only pages those 50 rows, so any register beyond 50 grievances has unreachable records and the 'this page' counts describe only the first 50 (page.tsx:13-19; app/_data/loaders.ts:1521-1522).
- **Verified evidence:** app/_data/loaders.ts:1514-1522 getCrmGrievances defaults limit=50, page=1. grievances/page.tsx:13-17 forwards only status/priority/search; SP type (line 6) has no page. GrievancesTable.tsx:166 uses DataTable pageSize={15}, a client-only pager over the rows passed (DataTable.tsx:237). data.total is read (page.tsx:56) but no pager consumes it, so rows 51+ are unreachable, and the 'Open/Escalated/Resolved (this page)' tiles count only those <=50 rows (they are honestly labelled 'this page'). The loader already supports `page`.
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/page.tsx`, `apps/web/src/app/(app)/crm/grievances/GrievancesTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add `page` to SP and pass `page: Number(searchParams.page)||1` to getCrmGrievances.
  2. Render a server-driven pager (Prev/Next links using searchParams, showing 'Showing x-y of data.total') under the table; disable DataTable's internal pager (omit pageSize) or set pageSize equal to the API limit.
  3. Reword tiles: use server totals per status if the API can return them, else keep 'this page' labels.
  4. Include page in the useSeededResource cache key so pages do not overwrite each other ('crm.grievances' key).
- **Acceptance:**
  - Test with 120 mocked rows: page 3 is reachable and shows rows 101-120.
  - Header shows 'Showing 1-50 of 120'.
  - Changing filters resets page to 1.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** High operational: a register silently truncated at 50 hides overdue grievances. Same loader pattern (limit 50) is used by service-requests.
- **Depends on:** GAP-CRM-GRIEVANCES-02

### GAP-CRM-GRIEVANCES-02  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** status, priority and search searchParams are forwarded to the API, but no control on the page sets them (the only filter is DataTable's client-side search), so server-side filtering is reachable only by hand-editing the URL (page.tsx:6, 13-17; GrievancesTable.tsx:102-103).
- **Verified evidence:** grievances/page.tsx:6,13-17 forwards status/priority/search to the API, and the comment (9-12) claims server-side filtering. GrievancesTable.tsx has only DataTable's client-side `filterable` box (line 164-165) which filters just the fetched rows; no select/links set ?status= or ?priority=, and the search box does not write ?search=. So server filtering works only via hand-edited URL, and the visible search cannot reach records beyond the first 50.
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/page.tsx`, `apps/web/src/app/(app)/crm/grievances/GrievancesTable.tsx`
- **Fix steps:**
  1. Add a small client <GrievanceFilters> (status select with the 5 CPGRAMS statuses, priority select, search input) that updates the URL query via router.replace (debounced for search) and resets page.
  2. Turn off DataTable `filterable` (or keep it labelled as 'filter this page').
  3. Show active filters and a 'Clear' link; preserve them across pagination links.
  4. Validate status/priority against the known enum before forwarding.
- **Acceptance:**
  - Manual: choosing Status=Forwarded changes URL and lists only FORWARDED rows from all pages.
  - Test: searching a reference number on page 3 finds it.
  - Reload keeps filters.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; must ensure the API accepts the search param as forwarded (backend behaviour cannot-verify).
- **Depends on:** GAP-CRM-GRIEVANCES-01

### GAP-CRM-GRIEVANCES-03  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** On an outage the tiles correctly show '—' but the table still renders 'No grievances yet — log the first citizen grievance', which reads as an empty register (GrievancesTable.tsx:107-109, page.tsx:32).
- **Verified evidence:** page.tsx:32 stat() shows '—' when source==='error' and line 59 passes source='error' to GrievancesTable. But GrievancesTable.tsx:170-171 always sets emptyTitle 'No grievances yet' / 'Use the button above to log the first citizen grievance', which DataTable shows when rows are empty (DataTable.tsx:319-320). Mitigation: line 110 renders DataSourceBadge with the hook's provenance, so an error banner appears above when useSeededResource reports an error; the empty state text still contradicts it. Cached rows may be shown instead if the sync cache has data.
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/GrievancesTable.tsx`, `apps/web/src/app/(app)/crm/grievances/page.tsx`
- **Fix steps:**
  1. In page.tsx, when source==='error' and no cached data, render <LoadErrorState result={result} area='grievances' backHref='/crm' /> instead of the table (keep the header).
  2. Or in GrievancesTable pass emptyTitle/emptyMessage conditionally: when provenance==='error' show 'Couldn't load grievances' with a retry (RefreshErrorState) rather than the first-use copy.
  3. Keep the new-grievance CTA only in the true-empty case.
- **Acceptance:**
  - Test: loader error renders retry error state and not the text 'No grievances yet'.
  - Test: successful empty list still shows the first-use empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-GRIEVANCES-04  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-07b #2026: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** dueAt is mapped by the loader but no column, overdue marker or sort exposes it, so a clerk cannot see which grievances are near or past their disposal deadline (app/_data/loaders.ts:1539; GrievancesTable.tsx:50-98).
- **Verified evidence:** loaders.ts:1539 maps dueAt into CrmGrievanceRow, but GrievancesTable.tsx columns (lines 50-98 of the file) are Ref, Citizen, Category, Subject, Priority, Status, Logged, View; dueAt and assignedTo (also mapped) are not shown, no overdue marker and no sort on due date. The detail page shows 'Due By' only after opening each record (page.tsx:~171).
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/GrievancesTable.tsx`, `apps/web/src/app/(app)/crm/grievances/page.tsx`
- **Fix steps:**
  1. Add a 'Due' column rendering the date; if dueAt < now and status !== 'DISPOSED' show a StatusPill 'Overdue' (STATUS_MAP already maps 'overdue' to bad) and a 'due in N days' hint for <=3 days.
  2. Make the column sortable with an ISO-date sort value.
  3. Add an 'Overdue' StatCard computed from rows (labelled this page) or a server filter if the API supports one.
  4. Consider adding the assignedTo column too.
- **Acceptance:**
  - Test: row with past dueAt and status REGISTERED shows Overdue; DISPOSED past-due row does not.
  - Sorting by Due puts earliest first.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; SLA display only. Timezone: compare on server-provided ISO timestamps.
- **Depends on:** GAP-CRM-GRIEVANCES-01

### GAP-CRM-GRIEVANCES-05  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Citizen names are listed and exported to CSV with the register and no role gate or masking; the export button is shown to every CRM role (DPDP data minimisation) (GrievancesTable.tsx:58, 105-106).
- **Verified evidence:** GrievancesTable.tsx column citizenName (line ~120) renders the name unmasked; DataTable is `exportable` (line 167) so ds/DataTable.tsx:274-290 downloadCsv writes every column, including the citizen name, to a client-side Blob for any user who can open the page. No role check, no audit call, no purpose prompt. Phone/email are not in this export (they are not in the list row), so exposure is names plus subject text.
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/GrievancesTable.tsx`, `apps/web/src/app/(app)/crm/grievances/page.tsx`
- **Fix steps:**
  1. Decide who may export the register (decision); pass `canExport` from the server page via getSessionRoles().
  2. Set `exportable={canExport}` on the DataTable.
  3. For allowed roles, route the export through a backend endpoint (or fire an audit event before downloadCsv) so exports are logged.
  4. Optionally show citizen name initials for roles without a need-to-know.
- **Acceptance:**
  - Manual: a role without export rights sees no CSV button.
  - Export by an allowed role writes an audit record with user, filter, row count.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP data-minimisation; audit endpoint must exist. DataTable is shared so add an optional onExport hook rather than changing behaviour globally.
- **Depends on:** Masked (new shared component), GAP-CRM-GRIEVANCES-DETAIL-05

### GAP-CRM-GRIEVANCES-06  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Status shows raw enum text (REGISTERED, APPEAL) in StatusPill, and the tile 'Escalated' counts APPEAL rows which the actions call 'First Appeal'; priority pills use var(--bg) text on var(--ink2) backgrounds (GrievancesTable.tsx:9-14, 80; page.tsx:30, 54).
- **Verified evidence:** Overstated: StatusPill (ds/StatusPill.tsx) passes status through humanizeStatus (lib/formatters.ts:44), so users see 'Registered', 'Forwarded', 'Attended', 'Disposed', 'Appeal', not raw uppercase. True: none of the five CPGRAMS values is in STATUS_MAP, so all fall back to the neutral 'info' variant (no visual difference between Registered, Attended, Disposed, Appeal). True: page.tsx:30,54 tile 'Escalated (this page)' counts APPEAL while the detail action is 'First Appeal' and detail timeline says 'Escalated'. True: priority pill uses color var(--bg) on var(--ink2)/var(--warn)/var(--bad) (GrievancesTable.tsx:9-14,80); actual contrast in dark theme is unverified.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/crm/grievances/page.tsx`, `apps/web/src/app/(app)/crm/grievances/GrievancesTable.tsx`
- **Fix steps:**
  1. Add to STATUS_MAP: registered:'info', forwarded:'warn', attended:'warn', disposed:'good' (or mut), appeal:'bad'; check other modules do not use these keys with a different meaning.
  2. Rename the tile to 'First appeal (this page)' and use 'First appeal' label via StatusPill `label` for APPEAL; align the detail timeline label.
  3. Replace the priority span with StatusPill-style pill classes (pill bad/warn/mut) so text colour and background are theme-safe; run a contrast check in both themes.
- **Acceptance:**
  - Snapshot: DISPOSED renders with the chosen tone class, APPEAL with 'bad'.
  - Labels 'First appeal' consistent across list tile, table and detail.
  - Priority pills pass WCAG AA contrast (4.5:1) in light and dark.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** StatusPill is shared by all modules: adding new keys can recolour other screens that use the same words ('appeal', 'attended').

### GAP-CRM-GRIEVANCES-07  ·  LOW  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx has no stat-tile placeholders while the loaded page leads with four tiles, causing layout shift (grievances/loading.tsx).
- **Verified evidence:** grievances/loading.tsx renders a breadcrumb bar, a title bar and one h-80 block. The loaded page (page.tsx:52-57) shows a StatGrid with four StatCards between header and table, so the skeleton lacks the tile row and the table below shifts down on load. Same hard-coded slate-200 / max-w-7xl styling as other loading files. Theme FABRICATED does not apply.
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/loading.tsx`
- **Fix steps:**
  1. Add a 4-column tile skeleton row (grid-cols-2 md:grid-cols-4, h-24) between the title and table blocks, as health/[accountId]/loading.tsx already does.
  2. Prefer the ds Skeleton component and theme tokens over slate-200.
- **Acceptance:**
  - Visual: no vertical layout shift between skeleton and loaded page.
  - Dark mode skeleton is not a light-grey block.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /crm/grievances/[id]  —  `crm/grievances-detail.html`

- **Source:** `apps/web/src/app/(app)/crm/grievances/[id]/page.tsx`
- **Design reference:** `redesign/crm/grievances-detail.html`

### GAP-CRM-GRIEVANCES-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme CONCURRENCY (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The detail type carries `version` but every lifecycle PATCH (forward, first-appeal, resolve, close) is sent without it or an If-Match, so two clerks acting on the same grievance overwrite each other with no conflict signal (grievances/[id]/page.tsx:25; GrievanceActions.tsx:46-56).
- **Verified evidence:** grievances/[id]/page.tsx:25 declares `version: number` on GrievanceDetail but it is never read. GrievanceActions.tsx:46-56 `patch()` sends only Content-Type and the payload; no version in body, no If-Match. apps/web/src/app/api/proxy/[...path]/route.ts:7 FORWARD allow-list omits if-match, so even a header set in the browser would be dropped. Whether crm-service enforces version is cannot-verify (services/crm-service is absent from the snapshot; only hrms-service exists).
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/[id]/GrievanceActions.tsx`, `apps/web/src/app/(app)/crm/grievances/[id]/page.tsx`, `apps/web/src/app/api/proxy/[...path]/route.ts`
- **Fix steps:**
  1. Confirm with the crm-service owner whether PATCH forward/first-appeal/resolve/close accept `If-Match: <version>` or `expectedVersion` in the body and return 409 on mismatch; if not, raise a backend ticket first.
  2. Add "if-match" to the FORWARD array in app/api/proxy/[...path]/route.ts (needed only if the header route is chosen).
  3. Pass `version={g.version}` from page.tsx into <GrievanceActions>; add it to the props type.
  4. In patch(), send the version (header `If-Match` or body field per backend contract).
  5. On res.status === 409 show a dedicated message ('This grievance was changed by someone else. Refresh to see the latest.') and call router.refresh() instead of the generic save message (see -03).
- **Acceptance:**
  - Component test: clicking Forward sends a PATCH whose request carries the version from props.
  - Manual: open the same grievance in two sessions, forward in A, then resolve in B without refreshing; B gets the conflict message and no status change is written.
  - Proxy test: a request with If-Match reaches the upstream fetch headers.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Adding the header before the backend honours it is harmless; the risk is the reverse, a backend that rejects a missing version would break all four actions. Approvals/state transitions on a citizen grievance.
- **Depends on:** GAP-CRM-GRIEVANCES-DETAIL-03

### GAP-CRM-GRIEVANCES-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE (was CONFIRM)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Close' is offered to every CRM role with the text 'Requires administrator rights', so non-admins confirm the dialog and then get the generic failure message (GrievanceActions.tsx:100-106, 15-18).
- **Verified evidence:** GrievanceActions.tsx:100-106 always renders the danger 'Close' ActionButton with confirmDescription 'Requires administrator rights'. The component takes only {id, status} (line 39); page.tsx:253 passes no role information. A non-admin confirms the dialog, `patch('close')` gets a non-ok response and throws the generic 'couldn't save' text (lines 15-18, 52-54). Server-side session roles are available via lib/auth/roleGuard.ts getSessionRoles(), but the page does not use it. The exact role name that is 'administrator' cannot be verified (crm-service absent).
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/[id]/page.tsx`, `apps/web/src/app/(app)/crm/grievances/[id]/GrievanceActions.tsx`
- **Fix steps:**
  1. Get the exact role names allowed to call PATCH /close from crm-service (decision/backend answer).
  2. In page.tsx call getSessionRoles() from lib/auth/roleGuard and compute `canClose`.
  3. Add `canClose: boolean` prop to GrievanceActions; when false do not render the Close button (or render it disabled with a title explaining who can close).
  4. Keep the server as the enforcer; keep the dialog text.
  5. Optional: give Close `requireReason` so the closure reason is recorded, if the backend accepts one.
- **Acceptance:**
  - Component test: canClose=false renders no 'Close' button; canClose=true renders it.
  - Manual: sign in as a non-admin CRM role, open a non-disposed grievance, no Close action offered.
  - Direct PATCH /close as non-admin still returns 403 (backend check).
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Wrong role list would hide Close from legitimate admins; UI hiding is not a security control.
- **Depends on:** GAP-CRM-GRIEVANCES-DETAIL-03

### GAP-CRM-GRIEVANCES-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Every failed action, whether 403, 409 or 5xx, throws the same catalogued 'save' message via grievanceActionError() (no status passed), so a permission refusal looks like a transient error (GrievanceActions.tsx:15-18, 52-54).
- **Verified evidence:** GrievanceActions.tsx:15-18 grievanceActionError() takes no argument and always returns toHumanError('save', {area:'grievance'}) = "We couldn't save your grievance. Nothing was changed. Please try again in a moment." Lines 52-54 throw it for any !res.ok, so 403, 409, 422 and 5xx are identical; useConfirmAction (ds/ActionButton.tsx) shows e.message in the dialog. lib/messages.ts has no forbidden/conflict MessageKind, so a new kind or a dedicated string is needed.
- **Files to change:** `apps/web/src/lib/messages.ts`, `apps/web/src/app/(app)/crm/grievances/[id]/GrievanceActions.tsx`
- **Fix steps:**
  1. Extend MessageKind/toHumanError in lib/messages.ts with 'forbidden' ("You don't have permission to do this. Ask an administrator.") and 'conflict' ("Someone else changed this grievance. Refresh and try again.").
  2. Change grievanceActionError to accept res.status (read only to choose the kind, never echoed): 403 -> forbidden, 409 -> conflict, else save.
  3. In patch() pass res.status; on 409 also router.refresh().
  4. Do not show backend text (per UX-003 rule in useFormError).
- **Acceptance:**
  - Unit test: grievanceActionError(403|409|500) returns three distinct messages and none contains the digits of the status.
  - Manual: non-admin clicking Close sees the permission message, not a retry message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; copy-only. messages.ts is shared so add kinds without changing existing ones.

### GAP-CRM-GRIEVANCES-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme MISSING-FIELD (was WIRING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Forward stores forwardedTo and First Appeal stores appealReason, but GrievanceDetail has neither field, so the department a grievance was forwarded to and the appeal reason are never displayed after saving; the Status Timeline has no 'Forwarded' step and 'Assigned' never shows a time (page.tsx:6-26, 129-135).
- **Verified evidence:** page.tsx:6-26 GrievanceDetail has no forwardedTo or appealReason; nothing in the Details/Resolution cards renders them. GrievanceActions.tsx:75 sends {forwardedTo} and :85 sends {appealReason}. Timeline (page.tsx:129-135) has Logged/Assigned/Escalated/Resolved/Closed; 'Assigned' has `ts: undefined` (line 131) so never shows a time, and there is no Forwarded step although FORWARDED is a status. Whether the GET returns forwardedTo/appealReason/forwardedAt/assignedAt is cannot-verify (crm-service absent).
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/[id]/page.tsx`
- **Fix steps:**
  1. Confirm the GET /api/v1/crm/grievances/:id response fields for forward and appeal (forwardedTo, forwardedAt, appealReason, assignedAt); if missing, backend ticket.
  2. Add the fields as optional to GrievanceDetail.
  3. Add 'Forwarded to' and 'Appeal reason' rows to the details card (show only when present).
  4. Add a 'Forwarded' step to timelineSteps (done when status is FORWARDED or later / forwardedTo set) with forwardedAt; give 'Assigned' its real timestamp or drop the step; rename 'Escalated' to 'First appeal' to match the action.
  5. Render appealReason in its own Card like Resolution.
- **Acceptance:**
  - Manual: forward a grievance to 'Water Dept'; after refresh the detail page shows 'Forwarded to: Water Dept' and a Forwarded timeline step with time.
  - Manual: file first appeal with reason; reason is visible on the page.
  - Render test with a fixture including the new fields.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only display. Do not show fields the backend does not return (would render blanks).

### GAP-CRM-GRIEVANCES-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Citizen phone and email are shown in full to every CRM role, with no masking or role gate (DPDP), alongside a free-text description that may contain further personal data (page.tsx:227-230).
- **Verified evidence:** page.tsx:227-230 (Citizen card) prints g.citizenPhone and g.citizenEmail verbatim; the page has no requireAnyRole/getSessionRoles call and no reveal/audit. Description is printed pre-wrapped in full (line ~179-191). No shared masking component exists: only page-local maskPhone in telephony/calls/page.tsx:37 and a MaskedInput in hr/employees/new/steps/Step4.tsx. Also the list table exports citizenName to CSV (see -LIST-05).
- **Files to change:** `apps/web/src/app/_components/ds/Masked.tsx`, `apps/web/src/app/_components/ds/index.ts`, `apps/web/src/app/(app)/crm/grievances/[id]/page.tsx`
- **Fix steps:**
  1. Create a shared client <Masked value type='phone'|'email'> (e.g. 98******10, a***@d***.in) with an optional reveal button gated by `canReveal`.
  2. Reveal must POST an audit event (backend endpoint needed; CLAUDE.md audit-events rule) before showing the clear value.
  3. In page.tsx compute canReveal from getSessionRoles() and use <Masked> for phone and email.
  4. Decide which roles may see contact data in clear (decision); default masked.
- **Acceptance:**
  - Component test: Masked renders masked text by default and clear text only after reveal when canReveal is true.
  - Manual: a role without reveal right never sees clear phone/email in the DOM.
  - Each reveal produces an audit record (backend).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII/DPDP. Masking only in UI still ships clear values in the RSC payload; ideal fix is backend-side masking for non-privileged roles.
- **Depends on:** Masked (new shared component)

### GAP-CRM-GRIEVANCES-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme RESPONSIVE (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1859, verified on main 9c5e9e9e9; W1 SF-12 re-confirmed on #2003)
- **First-pass claim:** The two-column layout is an inline `1fr 320px` grid with no breakpoint, so at phone width the main column is squeezed to a sliver (page.tsx:148).
- **Verified evidence:** page.tsx:148 `style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}` is inline, so no media query can override it; at 360px the main column is ~1fr of 360-320-20 minus gutters, a sliver. The same inline pattern exists in crm/rti/[id]/page.tsx:80 and crm/service-requests/[id]/page.tsx:99. Also the 140px/1fr details dl (line ~155) does not collapse. Theme tag PII is wrong.
- **Files to change:** `apps/web/src/app/globals.css`, `apps/web/src/app/(app)/crm/grievances/[id]/page.tsx`, `apps/web/src/app/(app)/crm/rti/[id]/page.tsx`, `apps/web/src/app/(app)/crm/service-requests/[id]/page.tsx`
- **Fix steps:**
  1. Add a shared class (e.g. .detail-split { display:grid; grid-template-columns: minmax(0,1fr) 320px; gap:20px } with @media (max-width: 900px) { grid-template-columns: 1fr }) in the global stylesheet the ds components use.
  2. Replace the inline style on page.tsx:148 with className='detail-split'.
  3. Apply the same class to the RTI and service-request detail pages.
  4. Let the dl grid drop to a single column below 480px.
- **Acceptance:**
  - Visual check at 360px and 768px: cards stack, no horizontal scroll.
  - At >=1024px layout unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; CSS only.

### GAP-CRM-GRIEVANCES-DETAIL-07  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1859, verified on main 9c5e9e9e9; W1 SF-12 re-confirmed on #2003)
- **First-pass claim:** A failed fetch renders 'Grievance Not Found' (title) with only 'The grievance could not be loaded.' beneath, so an outage is titled as a missing record (page.tsx:117-126).
- **Verified evidence:** page.tsx:117-126: `if (!g)` renders PageHeader title 'Grievance Not Found', a DataSourceBadge only when source==='error', and 'The grievance could not be loaded.' There is no distinction between HTTP 404 and network/5xx/403, although fetchJson returns `status` (app/_data/apiClient.ts LoaderResult) and ds/LoadErrorState.tsx already implements 403/other handling with RefreshErrorState; hr/apar/[id]/page.tsx:97 shows the intended pattern.
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/[id]/page.tsx`, `apps/web/src/app/(app)/crm/rti/[id]/page.tsx`
- **Fix steps:**
  1. Capture the full result: `const result = await fetchJson(...)` and read result.status.
  2. If result.source==='error' and status!==404 render PageHeader title 'Grievance' plus <LoadErrorState result={result} area='grievance' backHref='/crm/grievances' />.
  3. Only for status===404 (or a successful empty body) render the 'Grievance not found' EmptyState with a back link.
  4. Apply the same to crm/rti/[id] which has identical copy.
- **Acceptance:**
  - Test: mocked 500 renders a retry error state, not 'Not Found'.
  - Test: mocked 404 renders 'Grievance not found'.
  - Test: 403 renders the permission state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-GRIEVANCES-DETAIL-08  ·  LOW  ·  confirmed  ·  theme DEADCODE (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The `!disposed` guard around Resolve is dead code, because the disposed case has already returned the 'no further action' line above it; assignedTo is printed as returned, with no evidence it is a person's name rather than an id (GrievanceActions.tsx:42-64, 88; page.tsx:170).
- **Verified evidence:** GrievanceActions.tsx:43-44 `terminal` and `disposed` are both `status === 'DISPOSED'`; line 58 returns early when terminal, so `{!disposed && ...}` at line 88 is always true (dead guard). page.tsx:170 (`{g.assignedTo ?? 'Unassigned'}`) prints the value as-is; whether it is a name or a user id is cannot-verify (crm-service absent, list loader maps it only via toText). Theme DEADROUTE is wrong (no route involved).
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/[id]/GrievanceActions.tsx`, `apps/web/src/app/(app)/crm/grievances/[id]/page.tsx`
- **Fix steps:**
  1. Delete the `disposed` const and unwrap the Resolve ActionButton at lines 88-98.
  2. Keep `terminal` as the single flag.
  3. Confirm what GET returns in assignedTo; if it is a UUID, resolve to a display name (or expose assignedToName from backend) before rendering.
- **Acceptance:**
  - Component test: status REGISTERED shows Forward, First Appeal, Resolve, Close; DISPOSED shows only the 'no further action' text.
  - Manual: assigned grievance shows a person's name, never a raw UUID.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /crm/grievances/new  —  `crm/grievances-new.html`

- **Source:** `apps/web/src/app/(app)/crm/grievances/new/page.tsx`
- **Design reference:** `redesign/crm/grievances-new.html`

### GAP-CRM-GRIEVANCES-NEW-01  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** (W0 closed by #1859; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: PHONE_RE/EMAIL_RE inline validation and the DPDP notice are present)
- **First-pass claim:** Citizen phone and email are collected with no purpose or consent notice and no format check beyond the input type, although this is personal data under DPDP; the record is not linked to an existing CRM contact and no duplicate check is run (grievances/new/page.tsx:113-147).
- **Verified evidence:** grievances/new/page.tsx:113-147: Phone is `type='tel' maxLength=32`, Email `type='email' maxLength=320`; no pattern, no purpose or consent text anywhere on the page, and body (lines 23-31) posts only the raw fields; no contact lookup or duplicate check code exists. Backend duplicate/contact linking is cannot-verify (crm-service absent).
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/new/page.tsx`
- **Fix steps:**
  1. Add a short notice under the Citizen Details legend stating purpose ('Used only to respond to this grievance') and retention, wording agreed with the DPO (decision).
  2. Add client validation with a zod schema (phone pattern for Indian mobile / +91, email format) and show errors through inline spans like the name field.
  3. Render inline fieldError for phone/email (see -02).
  4. If backend supports it, add a lookup by phone/email to link an existing CRM contact and warn on a probable duplicate open grievance; otherwise raise a backend ticket.
- **Acceptance:**
  - Component test: 'abc' in Phone blocks submit with an inline message.
  - Manual: notice is visible above the phone and email fields.
  - If duplicate check is built: entering an existing phone shows a warning with a link.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** DPDP notice wording is a legal decision; stricter phone validation may reject valid foreign numbers.
- **Depends on:** GAP-CRM-GRIEVANCES-NEW-02

### GAP-CRM-GRIEVANCES-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Inline errors exist only for name, category, subject and description; a server rejection of phone, email or priority appears only in the top banner, not next to the field (page.tsx:109, 179, 222, 243 versus 113-147, 183-202).
- **Verified evidence:** new/page.tsx renders formError.fieldError() for citizenName (109), category (179), subject (222), description (243) only; phone (113-130), email (131-147) and priority (183-202) have none. useFormError.fromResponse (lib/useFormError.ts:100-108) fills fieldErrors from the backend envelope for any field, but the top banner (page.tsx:69-84) shows only the generic catalogued 'couldn't save' sentence, so a phone/email rejection tells the clerk nothing about which field failed.
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/new/page.tsx`
- **Fix steps:**
  1. Add the `{formError.fieldError('citizenPhone') && <span ...>}` block under the phone input, same for citizenEmail and priority (copy the existing span style).
  2. Set aria-invalid and aria-describedby on inputs that have an error.
  3. Consider extracting a small <FieldError name> helper to avoid the repeated four-line block (used in FollowUpModal too).
- **Acceptance:**
  - Test: mocked 422 with fieldErrors [{field:'citizenEmail',...}] renders that message below Email.
  - Manual: invalid phone rejected by server shows the message beside the phone field.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-GRIEVANCES-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme CONFIG (was FABRICATED)

- [x] **Status** (W0 closed by #1859; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: categories load from the tenant master with a fallback list)
- **First-pass claim:** The nine categories are hard-coded in the page rather than loaded from the department's taxonomy, so they cannot be aligned to CPGRAMS categories or changed by an administrator (page.tsx:7-11).
- **Verified evidence:** new/page.tsx:7-11 hard-codes nine category strings used in the select (lines 175-177). Nothing loads a taxonomy, and the string (not an id) is posted. Whether a category-master or CPGRAMS-category endpoint exists is cannot-verify (crm-service absent); no loader for it exists in app/_data/loaders.ts. Not a 'fabricated figure' - it is configuration hard-coding.
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/new/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Decide with the department the source of truth (CPGRAMS category list vs tenant-configured master).
  2. If a backend list endpoint exists/gets built, add getGrievanceCategories() in loaders.ts and fetch it in a server wrapper, passing categories as props to the client form.
  3. Keep the current array only as a documented fallback when the load fails, with an inline notice.
  4. Post a category id/code if the backend supports it.
- **Acceptance:**
  - Manual: adding a category in admin makes it appear in the select without a deploy.
  - Load failure shows the fallback list plus a notice, never an empty select.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Existing grievances carry free-text categories; changing to ids needs migration/mapping.

### GAP-CRM-GRIEVANCES-NEW-04  ·  LOW  ·  confirmed  ·  theme BUSINESS-RULE (was OTHER)

- [x] **Status** (W0 closed by #1860; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: guidance text under Priority explains when Urgent applies)
- **First-pass claim:** Any clerk can log a grievance directly as Urgent; there is no rule or note on when Urgent applies, and the detail page separately raises priority to urgent on First Appeal (page.tsx:197-200; grievances/[id]/GrievanceActions.tsx:82).
- **Verified evidence:** new/page.tsx:197-200 offers Low/Normal/High/Urgent to every user with no help text. GrievanceActions.tsx:82 says first appeal 'escalates to urgent priority' (the server-side bump itself is cannot-verify). No role check exists in either file.
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/new/page.tsx`
- **Fix steps:**
  1. Get the business rule for Urgent (who may set it, criteria) - decision.
  2. Add a one-line hint under Priority describing when to use Urgent, and/or restrict the option by role via getSessionRoles passed from a server wrapper.
  3. If backend enforces, surface its rejection as an inline priority error (see -02).
- **Acceptance:**
  - Manual: hint text visible under Priority.
  - If restricted: non-authorised role does not see Urgent and a forged POST is rejected.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; restricting Urgent changes clerk workflow.
- **Depends on:** GAP-CRM-GRIEVANCES-NEW-02

### GAP-CRM-GRIEVANCES-NEW-05  ·  LOW  ·  partly  ·  theme WIRING

- [x] **Status** (W1 SF-19: closed by #2014; earlier W0 tick #1860 re-confirmed against 9e34d2e4a: the unsaved-changes prompt on Cancel was a native window.confirm; it is now ds/ConfirmDialog (Escape and Keep editing both keep the form); browserFetch already sends x-device-id)
- **First-pass claim:** Cancel is a plain link with no unsaved-changes prompt, and the form uses uncontrolled FormData with raw fetch to /api/proxy instead of the browserFetch used by sibling forms (page.tsx:22-38, 251).
- **Verified evidence:** True: Cancel is `<a href='/crm/grievances' className='btn'>` (page.tsx:251) with no dirty-form guard; form reads values via FormData (line 22) and posts with raw fetch('/api/proxy/v1/crm/grievances') (34-38). Overstated: browserFetch is used by 8 files under crm but 10 files also use raw fetch to /api/proxy (incl. GrievanceActions.tsx and FollowUpModal.tsx), so raw fetch is common in the sibling grievance/health code, not a deviation. browserFetch (lib/api/browserClient.ts:21) adds x-device-id and trust headers, which the raw call omits. Cancel as plain <a> also forces a full page reload instead of client navigation.
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/new/page.tsx`
- **Fix steps:**
  1. Replace the Cancel <a> with next/link <Link>.
  2. Track dirty state (onChange on the form) and intercept Cancel/back with window.confirm or the ds ConfirmDialog when dirty; add a beforeunload handler while dirty.
  3. Switch the POST to browserFetch('/v1/crm/grievances', {method:'POST', body}) so device headers are sent, matching the browserClient contract.
- **Acceptance:**
  - Manual: typing in Subject then clicking Cancel asks for confirmation; empty form cancels straight away.
  - Network tab: POST carries x-device-id.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; browserFetch sets content-type itself so do not duplicate.

### GAP-CRM-GRIEVANCES-NEW-06  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx is max-w-7xl with a full-width block while the form is a 640px card, so the skeleton and loaded page have different widths (grievances/new/loading.tsx; page.tsx:66).
- **Verified evidence:** grievances/new/loading.tsx renders `mx-auto max-w-7xl` with header bars and an `h-80 rounded-xl` block; the loaded page (page.tsx:60-67) is PageHeader plus a card with maxWidth 640. It is byte-identical to grievances/loading.tsx, so the new-form route shows a table-shaped skeleton. It also uses hard-coded Tailwind slate-200 / min-h-screen rather than tokens (dark-mode mismatch).
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/new/loading.tsx`
- **Fix steps:**
  1. Rewrite new/loading.tsx with a header skeleton and a single card skeleton at maxWidth 640 with ~5 field bars and a button bar, using the ds Skeleton component (app/_components/ds/Skeleton.tsx) instead of raw slate classes.
  2. Drop min-h-screen wrapper if the layout already provides page padding.
- **Acceptance:**
  - Visual: skeleton card width equals loaded form card (640px), no jump on load.
  - Dark mode: skeleton uses theme tokens.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-GRIEVANCES-NEW-07  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 closed by #1860; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: description character counter (aria-live polite) present)
- **First-pass claim:** Required marks use a decorative asterisk with no legend such as 'Fields marked * are required'; the description has a 5,000-character limit but no counter (page.tsx:93, 231).
- **Verified evidence:** new/page.tsx:93, 160, 206: required marks are `<span aria-hidden='true'>*</span>` with the native `required` attribute doing the semantic work; there is no 'Fields marked * are required' legend. Description textarea has maxLength={5000} (line 231) and no live counter; the browser silently stops typing at the limit.
- **Files to change:** `apps/web/src/app/(app)/crm/grievances/new/page.tsx`
- **Fix steps:**
  1. Add `<p>` 'Fields marked * are required' above the first fieldset.
  2. Make description controlled (useState length) or use onInput to update a counter `{n}/5000` with aria-live='polite' under the textarea.
  3. Optionally do the same for Subject (500).
- **Acceptance:**
  - Manual: legend visible; typing updates the counter; counter turns warning colour near the limit.
  - Screen reader announces remaining characters politely.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /crm/health  —  `crm/health.html`

- **Source:** `apps/web/src/app/(app)/crm/health/page.tsx`
- **Design reference:** `redesign/crm/health.html`

### GAP-CRM-HEALTH-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-07b #2026: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed load the page prints the badge but Critical and At risk show 0 and the table says 'Every scored account is currently healthy or thriving', a false all-clear on the one screen meant to surface risk; the tiles have no '—' guard like Grievances / Lead Forms (health/page.tsx:13-14, 29-41; WatchlistTable.tsx:47-49).
- **Verified evidence:** health/page.tsx:8-14 derives source='error' when either loader fails (loaders return [] on failure, loaders.ts:1422,2990), but only renders <DataSourceBadge> (:28). Critical/At risk tiles (:30-41) show summary counts of 0 and WatchlistTable (WatchlistTable.tsx:47-49) shows 'Every scored account is currently healthy or thriving'. Correction: Average Score (:46) already shows '—' when total==0 and Call First falls back to '—', so only the two count tiles and the empty table lack a guard.
- **Files to change:** `apps/web/src/app/(app)/crm/health/page.tsx`, `apps/web/src/app/(app)/crm/health/WatchlistTable.tsx`
- **Fix steps:**
  1. In AccountHealthPage, when source==='error' return PageHeader + <RefreshErrorState error={{what:'Account health could not be loaded',next:'Retry, or open All Accounts',actions:['retry','back']}} backHref='/crm'/> instead of StatGrid/Card.
  2. Alternatively (if partial page preferred) add const stat=(n)=>source==='error'?'—':n.toLocaleString('en-IN') as in lead-forms/page.tsx:17 and apply to Critical/At risk/Average.
  3. Do not render <WatchlistTable> on error; pass no rows-as-empty.
  4. Keep DataSourceBadge only for the non-error partial case or drop it.
- **Acceptance:**
  - Component/RSC test: mock getAccountHealthWatchlist -> {data:[],source:'error'}; page shows retry state and no 'currently healthy' text.
  - Healthy load with empty list still shows 0 and 'No accounts at risk'.
  - Manual: stop recommendation-service; page shows error state, not zeros.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; risk of the reverse (false all-clear on a risk screen) is the business risk being removed.
- **Depends on:** RefreshErrorState (ds)

### GAP-CRM-HEALTH-02  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The watchlist is requested with limit=100 and nothing shows truncation, so counts and 'Average Score' silently describe at most 100 accounts; the average is over at-risk accounts only, yet is labelled a plain 'Average Score' (app/_data/loaders.ts:2990; health/health.ts:44-71).
- **Verified evidence:** loaders.ts:2990 requests /api/v1/recommendations/health/at-risk?limit=100; the loader keeps only payload.data (:2994) so any total is discarded. summariseWatchlist (health.ts:44-71) computes counts and averageScore over that capped, already at-risk-only list, yet the tile is labelled 'Average Score' (page.tsx:45). Whether the endpoint returns a total or supports offset is cannot-verify (recommendation-service absent from snapshot).
- **Files to change:** `apps/web/src/app/(app)/crm/health/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/crm/health/health.ts`
- **Fix steps:**
  1. Relabel tile to 'Average score (at-risk accounts)' immediately.
  2. Extend accountHealthWatchlistSchema/getAccountHealthWatchlist to also return total/next cursor if the endpoint provides them; otherwise detect data.length===100 and show 'Showing first 100'.
  3. Show a truncation notice in the Card header when capped.
  4. If backend supports paging, move filter/sort to query params and paginate server-side.
- **Acceptance:**
  - Unit test: loader mock returning 100 rows renders 'first 100' notice.
  - Tile label reads 'at-risk accounts' average.
  - Backend: endpoint returns total count (verify).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; misleading aggregate only.
- **Depends on:** GAP-CRM-HEALTH-01

### GAP-CRM-HEALTH-03  ·  MEDIUM  ·  confirmed  ·  theme DATA-JOIN (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Names are joined from getCrmAccounts (one unparameterised call), so any account not in that response appears as 'Unknown account' with no id or link text to identify it, and can also be picked as 'Call First' (health/health.ts:86-95, page.tsx:16-18).
- **Verified evidence:** health.ts:86-95 joins by accounts.id from getCrmAccounts() (loaders.ts:1421, no params, 30s cache) and falls back to 'Unknown account' (:93). page.tsx:16-18 picks worstName from that joined list so a missing account can be 'Call First'; row shows no id. Note the fallback is deliberate (doc comment :80-84 avoids hiding accounts). Whether getCrmAccounts is itself paginated/capped is cannot-verify (crm-service absent).
- **Files to change:** `apps/web/src/app/(app)/crm/health/health.ts`, `apps/web/src/app/(app)/crm/health/page.tsx`, `apps/web/src/app/(app)/crm/health/WatchlistTable.tsx`
- **Fix steps:**
  1. Change fallback to `Account ${accountId.slice(0,8)}` (or add unresolved:boolean on NamedAccountHealthEntry).
  2. In WatchlistTable render name as link text; rowHref already goes to /crm/health/[accountId] so keep it.
  3. In page.tsx, for Call First prefer the worst entry that has a resolved name, or show id-suffix when unresolved.
  4. Add ?ids= batch lookup to crm accounts if backend supports it (else leave).
- **Acceptance:**
  - health.test: withAccountNames with unknown id returns identifiable label containing the id fragment.
  - Call First tile never shows bare 'Unknown account'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-HEALTH-04  ·  MEDIUM  ·  confirmed  ·  theme I18N

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-07b #2026: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The empty-state copy hard-codes 'falls to 50 or below' as the at-risk rule although banding is owned by the recommendation-service; if thresholds change the message goes stale (WatchlistTable.tsx:49).
- **Verified evidence:** WatchlistTable.tsx:49 hard-codes 'falls to 50 or below'; health.ts:4 states banding is owned by recommendation-service and the client has no threshold constant. Also all page strings (title, subtitle, labels, filterPlaceholder) are literals, no next-intl.
- **Files to change:** `apps/web/src/app/(app)/crm/health/WatchlistTable.tsx`, `apps/web/src/app/(app)/crm/health/page.tsx`, `apps/web/messages/en.json`, `apps/web/messages/hi.json`
- **Fix steps:**
  1. Drop the numeric threshold from the empty message ('Accounts appear here once they are scored at risk or critical') or take it from API metadata if exposed.
  2. Move page/table strings to a 'crm.health' namespace in messages/en.json + hi.json; use getTranslations in page and useSafeTranslations-style in the client table.
  3. Add sr-only text/aria-label to StatusPill band cell (text label already present, so non-colour cue exists).
- **Acceptance:**
  - Change threshold in a mock: message contains no number.
  - hi locale renders translated headings.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-HEALTH-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The list has no owner, last-contact or next-action column and no way to start a follow-up from a row; the only action is to open the account first (WatchlistTable.tsx:31-38).
- **Verified evidence:** WatchlistTable.tsx:30-39 columns are Account, Band, Health Score, Last Scored only; rowHref (:41) is the only action. AccountHealthEntry carries no owner/last-contact (types in @civitasone/types; health.ts). Owner/next-action need crm account/activity data not in the payload.
- **Files to change:** `apps/web/src/app/(app)/crm/health/WatchlistTable.tsx`, `apps/web/src/app/(app)/crm/health/health.ts`, `apps/web/src/app/(app)/crm/health/page.tsx`
- **Fix steps:**
  1. Decide scope: owner from getCrmAccounts (if CRMAccountSummary has owner) and last-contact from activities.
  2. If owner exists, extend withAccountNames to withAccountContext and add Owner column.
  3. Add per-row 'Log follow-up' link to /crm/activities/new?accountId=... (verify route exists before adding).
  4. Otherwise defer as backend request.
- **Acceptance:**
  - Owner column populated for accounts with owner.
  - Follow-up link opens prefilled activity form.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; feature gap not defect.

### GAP-CRM-HEALTH-06  ·  LOW  ·  partly  ·  theme TOKENS (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Stat icons are emoji on hard-coded hex backgrounds (#fee2e2, #fef3c7, #e0f2fe, #fce7f3) rather than tokens (page.tsx:30-48).
- **Verified evidence:** Emoji icons with hex iconBg exist at page.tsx:31-48 (#fee2e2,#fef3c7,#e0f2fe,#fce7f3) as claimed, but this is the StatCard icon/iconBg API used across the app (lead-forms, deals/page.tsx:28), not a health-page one-off. Nothing here is fabricated data; theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/crm/health/page.tsx`, `apps/web/src/app/_components/ds/StatCard.tsx`, `apps/web/src/app/_components/ds/StatIcon.tsx`
- **Fix steps:**
  1. Fix at StatCard level: accept icon name + tone token (danger/warning/info) mapping to CSS variables.
  2. Replace emoji + hex on this page with StatIcon tones; update other pages in the same sweep.
- **Acceptance:**
  - No literal hex in health/page.tsx (grep).
  - Dark mode renders tile icons with token colours.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; cosmetic.
- **Depends on:** StatCard/StatIcon tone prop


---
## /crm/health/[accountId]  —  `crm/health-accountId.html`

- **Source:** `apps/web/src/app/(app)/crm/health/[accountId]/page.tsx`
- **Design reference:** `redesign/crm/health-accountId.html`

### GAP-CRM-HEALTH-ACCOUNTID-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W1 SF-14a re-confirmed against main d0b65c3b5 (feature still present after the Field/Input conversion): closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The detail page never shows which account it describes: the title is a fixed 'Account Health', the subtitle is the scored time, and the follow-up dialog labels the account with its raw id (a UUID), so a clerk cannot confirm the target before creating a service request (health/[accountId]/page.tsx:49-52; FollowUpModal.tsx:144-154).
- **Verified evidence:** health/[accountId]/page.tsx:30 and 50 set title 'Account Health' (fixed); subtitle (51) is 'Scored <date>'. FollowUpModal.tsx:144-154 (file lines ~271-282) prints `Account: <code>{accountId}</code>`. Nothing on the page shows the account name; the breakdown fields used (accountId, score, band, version, computedAt, storedScore, contributingFactors) do not include a name, and the AccountHealthBreakdown type is in @civitasone/types which is absent from the snapshot. The View Account link (line 56) exists but only after the fact. Existing getCrmAccounts() (loaders.ts:1421, used by crm/accounts/[id]/page.tsx) can resolve the name.
- **Files to change:** `apps/web/src/app/(app)/crm/health/[accountId]/page.tsx`, `apps/web/src/app/(app)/crm/health/[accountId]/FollowUpModal.tsx`
- **Fix steps:**
  1. In page.tsx also call getCrmAccounts() in parallel (Promise.all) and find the account by id to get its name.
  2. Use the account name as PageHeader title (fallback 'Account health' plus short id); keep the scored time as subtitle.
  3. Pass `accountName` to FollowUpModal and show it in the dialog header instead of the raw id.
  4. Better long term: ask the recommendation-service to include accountName in the breakdown response (backend).
- **Acceptance:**
  - Manual: page title shows the account's name; dialog shows 'Account: <name>'.
  - If the name lookup fails, page still renders with fallback title.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** getCrmAccounts fetches the whole list (unpaginated) - acceptable for now but a by-id endpoint would be better.

### GAP-CRM-HEALTH-ACCOUNTID-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** On a fetch failure the page shows the badge and then 'This account has not been scored', which presents an outage as a scoring gap; getAccountHealthBreakdown returns null for both a 404 and an error (page.tsx:26-43; app/_data/loaders.ts:3002-3013).
- **Verified evidence:** loaders.ts:3002-3015 getAccountHealthBreakdown uses fetchJson with null fallback; any failure and a 404 both yield data=null. page.tsx:26-43 then renders EmptyState 'No health score yet ... This account has not been scored', with a DataSourceBadge only when source==='error' and still offers Create Follow-up. The loader doc says a 404 is expected, but does not separate it; fetchJson's LoaderResult.status (apiClient.ts) makes the split possible, as ds/LoadErrorState.tsx and hr/apar/[id] do.
- **Files to change:** `apps/web/src/app/(app)/crm/health/[accountId]/page.tsx`
- **Fix steps:**
  1. Keep the full result: `const result = await getAccountHealthBreakdown(...)`.
  2. If result.source==='error' && result.status!==404, render <LoadErrorState result={result} area='account health' backHref='/crm/health' /> (covers 403 and retry) and hide the follow-up action.
  3. Only status 404 (or successful null) shows the 'not scored yet' empty state.
- **Acceptance:**
  - Test: mocked 500 shows retry error state, no 'has not been scored' text.
  - Test: mocked 404 shows 'No health score yet'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-HEALTH-ACCOUNTID-03  ·  MEDIUM  ·  partly  ·  theme WIRING (was PII)

- [x] **Status** (W0 2026-10-13, W1 SF-14a re-confirmed against main d0b65c3b5 (feature still present after the Field/Input conversion): closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The follow-up reuses the citizen service-request API: it posts citizenName / citizenPhone for what is an account representative, and offers service types 'New Water Connection' and 'New Electricity Connection' for an account-health action, so the resulting record is mis-typed (FollowUpModal.tsx:77-85, 234-247).
- **Verified evidence:** True: FollowUpModal.tsx:77-85 (file lines ~204-212) POSTs {citizenName, citizenPhone, serviceType, subject, description, priority, relatedAccountId} to /api/proxy/v1/crm/service-requests, the citizen service-request API; select options (file ~363-374) include 'New Water Connection' and 'New Electricity Connection' next to health-specific ones. Softening: the name field label is 'Contact Name' with placeholder 'Citizen or account representative name', so it is partly acknowledged. Phone is optional. Whether the endpoint accepts these free-text service types, or a dedicated account follow-up endpoint exists, is cannot-verify (crm-service absent). Theme PII is mis-tagged; the issue is domain mis-typing.
- **Files to change:** `apps/web/src/app/(app)/crm/health/[accountId]/FollowUpModal.tsx`
- **Fix steps:**
  1. Remove 'New Water Connection' and 'New Electricity Connection' from the serviceType select (keep Account Health Follow-up, Renewal Support, Escalation, Other).
  2. Confirm with backend whether service-requests can carry a follow-up type / relatedAccountId as first-class fields, or whether a task/activity endpoint is the right target; if so switch the POST.
  3. Relabel the fields to 'Contact name' / 'Contact phone' in copy; consider prefilling from the account's primary contact.
  4. Do not log the phone in client errors.
- **Acceptance:**
  - Manual: the type list contains only account-relevant types.
  - Created record shows serviceType 'Account Health Follow-up' and relatedAccountId set.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Existing service-request reports may key on these type strings; removing options does not affect stored data.

### GAP-CRM-HEALTH-ACCOUNTID-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The default Subject embeds the raw account id ('Account health follow-up — 3f2a…'), which then becomes the service request's subject line (FollowUpModal.tsx:265).
- **Verified evidence:** FollowUpModal.tsx defaultValue `Account health follow-up — ${accountId}` (file line 392, i.e. ~265 of the modal body) on the Subject input; the user can edit it, but by default the created service request's subject contains the full id (likely a UUID; id format not verifiable). The subject is shown in SR lists and detail.
- **Files to change:** `apps/web/src/app/(app)/crm/health/[accountId]/FollowUpModal.tsx`, `apps/web/src/app/(app)/crm/health/[accountId]/page.tsx`
- **Fix steps:**
  1. Accept `accountName` prop (see -01) and default the subject to `Account health follow-up — ${accountName}` (fallback to 'this account' rather than the id).
  2. Include the band/score in the default subject only if wanted (e.g. 'At risk').
- **Acceptance:**
  - Manual: opening the modal for account 'Acme Ltd' prefills 'Account health follow-up — Acme Ltd'.
  - No UUID in the default subject.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-HEALTH-ACCOUNTID-01

### GAP-CRM-HEALTH-ACCOUNTID-05  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Value, Weight and Contribution print raw with no unit or scale, and 'Clamped' is unexplained jargon, so a clerk cannot tell why an account scored what it did or what to fix (page.tsx:101-108).
- **Verified evidence:** page.tsx:84-112: Weight is NOT raw - it is `Math.round(factor.weight*100)%` (line 102). True: Value (101) and Contribution (103) print `factor.value` and `factor.contribution` with no unit, scale, or explanation of what value range means (payload types absent, so the scale is cannot-verify). The column header is 'Data Quality' and the cell is a StatusPill 'Clamped' vs 'Reported' (105-107), with no tooltip or legend explaining that Clamped means the raw signal was capped to its allowed range. No guidance on what to fix per signal.
- **Files to change:** `apps/web/src/app/(app)/crm/health/[accountId]/page.tsx`, `apps/web/src/app/(app)/crm/health/health.ts`
- **Fix steps:**
  1. Confirm from the recommendation-service what value and contribution mean (0-100 normalised? points toward the composite?) and format them accordingly (e.g. '72 / 100', '+18.0 pts').
  2. Wrap the 'Data Quality' header or 'Clamped' pill in the ds Term/HelpTip (ds/Term.tsx, ds/HelpTip.tsx) with plain text: 'Clamped: the raw value was outside the allowed range and was capped for scoring'.
  3. Optionally add a per-signal hint in SIGNAL_LABEL (health.ts) suggesting what improves it.
- **Acceptance:**
  - Manual: hovering Clamped shows the explanation; Value/Contribution columns have units.
  - Test: table renders 'pts' suffix for contribution.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Wrong unit wording would mislead account managers; needs scoring-model owner sign-off.

### GAP-CRM-HEALTH-ACCOUNTID-06  ·  LOW  ·  defect  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** FollowUpButton.tsx is dead code (no importer in the snapshot) and duplicates the button already inside FollowUpModal; the modal's overlay is hand-rolled with a fixed z-index rather than the shared ConfirmDialog / dialog primitive (FollowUpButton.tsx:6-16; FollowUpModal.tsx:15-34).
- **Service:** `crm-service (web-only finding)`  ·  **Endpoint(s):** `['POST /api/proxy/v1/crm/service-requests (modal)']`
- **Question:** Is FollowUpButton.tsx unreferenced and FollowUpModal a hand-rolled overlay instead of the shared dialog primitive?
- **How to verify:** grep importers
- **Test to add:** 
- **Impact if wrong:** Dead code and inconsistent a11y/focus trap.
- **Web change if wrong:** Delete FollowUpButton.tsx; refactor FollowUpModal to shared dialog.
- **Finding:** apps/web/src/app/(app)/crm/health/[accountId]/page.tsx:5,32,55 import FollowUpModal directly; FollowUpButton.tsx:3-13 has no importer (grep across apps/web/src). FollowUpModal.tsx:16 uses position:fixed inline overlay.

### GAP-CRM-HEALTH-ACCOUNTID-07  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-07b #2026: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The 'Score Recomputed From Signals' card exposes a stored-vs-computed discrepancy as an explanation paragraph with no action or timestamp of the last recompute (page.tsx:116-124).
- **Verified evidence:** page.tsx:116-124 shows the 'Score Recomputed From Signals' card when storedScore !== score, as text only: 'A recompute will bring the stored value back in line.' There is no recompute button or link (whether a recompute endpoint exists is cannot-verify). Overstated: a scored timestamp is present in the header subtitle (line 51, breakdown.computedAt), though it is not in the card and it is not labelled as the last recompute. Also the paragraph uses hard-coded color #475569 (line 118) instead of a token, poor in dark mode (same for iconBg hex on lines 61-69).
- **Files to change:** `apps/web/src/app/(app)/crm/health/[accountId]/page.tsx`
- **Fix steps:**
  1. Add 'Computed <formatDateTime(breakdown.computedAt)>' inside the card.
  2. If the backend exposes a recompute endpoint, add a client button (ActionButton) calling it and refreshing the router; otherwise reword to say who runs the recompute.
  3. Replace `#475569` with var(--ink2) and the StatCard iconBg hex values with tokens.
- **Acceptance:**
  - Manual: card shows the compute time.
  - Dark mode: text in the card is legible.
  - If action added: clicking it triggers recompute and the card disappears when scores match.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; a recompute action (if added) is a state-changing operation needing audit.


---
## /crm/lead-forms  —  `crm/lead-forms.html`

- **Source:** `apps/web/src/app/(app)/crm/lead-forms/page.tsx`
- **Design reference:** `redesign/crm/lead-forms.html`

### GAP-CRM-LEAD-FORMS-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The empty state tells the user to 'Register a lead-capture form to mint a public key', but the page has no register, edit, pause or rotate control at all (page.tsx:21-26, no actions; LeadFormsTable.tsx:48-50); a consent-gap form flagged here cannot be fixed from this screen.
- **Verified evidence:** lead-forms/page.tsx:21-37 has PageHeader with no actions and a read-only table; LeadFormsTable.tsx:48-50 emptyMessage says 'Register a lead-capture form to mint a public key' but no control exists. Grep of apps/web shows the only reference to lead-capture-forms outside loaders is the export filename, so no create/update/rotate client exists. Backend POST/PATCH endpoints are cannot-verify (crm-service absent).
- **Files to change:** `apps/web/src/app/(app)/crm/lead-forms/page.tsx`, `apps/web/src/app/(app)/crm/lead-forms/LeadFormsTable.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/lib/crm/leadForms.ts (new client)`
- **Fix steps:**
  1. Confirm crm-service endpoints for create/update/enable/rotate-key.
  2. Add client actions (browserFetch + zod) and a LeadFormEditor dialog (name, allowedOrigins, requireConsent, defaultLeadSource, maxPerMinute).
  3. Add row actions Pause/Enable, Edit, Rotate key (ConfirmDialog for rotate) and 'Register form' button in PageHeader actions.
  4. Until built, change emptyMessage to not promise a control and add 'Fix consent' guidance.
- **Acceptance:**
  - Admin can register a form and it appears with a key.
  - Toggling requireConsent on an 'unlawful' form moves it to Live.
  - Rotate key requires confirm and is audited.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Config of public intake; needs audit events and role gate.
- **Depends on:** GAP-CRM-LEAD-FORMS-02

### GAP-CRM-LEAD-FORMS-02  ·  MEDIUM  ·  partly  ·  theme SECURITY (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The public submit endpoint is unauthenticated and 'keyed only by formKey' (leadForms.ts:1-8), yet the full key path is printed in the table for every CRM role and included in the CSV export, so anyone with the export can post leads into the tenant; origin allow-list and rate limit are the only guards (LeadFormsTable.tsx:23, 39, 45-47).
- **Verified evidence:** LeadFormsTable.tsx:23,39 show publicSubmitPath(formKey) (leadForms.ts:11-13) and DataTable.downloadCsv (DataTable.tsx:274-291) exports every column incl. it, no audit. But formKey is a public embed key by design (leadForms.ts:1-8 says operators paste the URL on landing pages), visible in page source to any visitor, so it is not a secret and masking is not the right control. Real gaps: no admin role gate on /crm/lead-forms (only crm layout), CSV export ungated/unaudited, and abuse protection (origin allow-list, maxPerMinute) is server-side, cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/crm/lead-forms/page.tsx`, `apps/web/src/app/(app)/crm/lead-forms/LeadFormsTable.tsx`, `apps/web/src/app/(app)/crm/lead-forms/layout.tsx (new)`
- **Fix steps:**
  1. Decide with security whether formKey is treated as public; if so keep visible but show only to crm_admin (add layout.tsx with requireAnyRole).
  2. Set exportable={false} or route export through an audited server action emitting an audit event.
  3. Verify server rate limit/origin check and Turnstile/captcha option.
- **Acceptance:**
  - crm_user cannot open the page (or sees masked path).
  - Export emits audit event with actor and row count.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low-medium; changing visibility affects admins' embed workflow.

### GAP-CRM-LEAD-FORMS-03  ·  MEDIUM  ·  confirmed  ·  theme STATUS (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The status value 'unlawful' is printed verbatim as the pill label and the tile says 'Consent gaps', giving two names for the same condition; the DPDP reason (enabled but requireConsent is false) is not stated anywhere on the page (LeadFormsTable.tsx:37; leadForms.ts:17-24).
- **Verified evidence:** LeadFormsTable.tsx:37 passes label={row.health} so pill shows 'unlawful' verbatim (StatusPill label override); page.tsx:31 tile says 'Consent gaps'. formHealth (leadForms.ts:21-25) returns 'unlawful' when enabled && !requireConsent; no page copy explains DPDP reason. 'Unlawful' is also a legal conclusion the UI should not assert.
- **Files to change:** `apps/web/src/app/(app)/crm/lead-forms/LeadFormsTable.tsx`, `apps/web/src/app/(app)/crm/lead-forms/page.tsx`, `apps/web/src/app/(app)/crm/lead-forms/leadForms.ts`
- **Fix steps:**
  1. Add HEALTH_LABEL map {live:'Live',paused:'Paused',unlawful:'Consent not required'} used by pill and tile ('Consent gaps' consistent).
  2. Add tooltip/inline note: 'Enabled without requiring consent; DPDP Act requires consent for marketing intake.'
  3. Keep enum value internal.
- **Acceptance:**
  - Pill text equals tile naming.
  - Note visible when count>0.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-LEAD-FORMS-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** On an outage the tiles show '—' but the table still says 'No website forms registered', reading as an empty registry (LeadFormsTable.tsx:48-50; page.tsx:17).
- **Verified evidence:** page.tsx:34 passes only ranked rows; on source==='error' forms=[] so LeadFormsTable shows emptyTitle 'No website forms registered' (LeadFormsTable.tsx:48-50) while tiles show '—' (page.tsx:17).
- **Files to change:** `apps/web/src/app/(app)/crm/lead-forms/page.tsx`
- **Fix steps:**
  1. When source==='error' render <RefreshErrorState> in place of the Card (keep tiles).
  2. Optionally pass an error flag to the table.
- **Acceptance:**
  - Mock error: retry state shown, no 'No website forms registered'.
  - Empty success still shows the empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-CRM-LEAD-FORMS-05  ·  LOW  ·  confirmed  ·  theme UX (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Allowed origins collapse to 'first +N more' with no way to see the rest, the URL is a relative gateway path with no host, copy button or embed snippet, and there is no search or status filter (leadForms.ts:37-41; LeadFormsTable.tsx:23-24).
- **Verified evidence:** leadForms.ts:37-41 originSummary returns 'first +N more' as plain text with no title/expand; publicSubmitPath is '/api/v1/crm/public/leads/<key>' relative (:11-13); LeadFormsTable passes sortable+exportable but not filterable (:45-46); no copy/embed control.
- **Files to change:** `apps/web/src/app/(app)/crm/lead-forms/LeadFormsTable.tsx`, `apps/web/src/app/(app)/crm/lead-forms/leadForms.ts`
- **Fix steps:**
  1. Render origins as a <details>/tooltip list or full comma list with title attribute.
  2. Add a client CopyButton building absolute URL from window.location.origin plus an 'Embed snippet' popover.
  3. Set filterable and filterPlaceholder='Filter by form…'; add status filter.
  4. Move strings to next-intl.
- **Acceptance:**
  - Hovering origins shows all values.
  - Copy puts absolute URL on clipboard.
  - Filter narrows rows.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-LEAD-FORMS-06  ·  LOW  ·  confirmed  ·  theme LOADING (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx is a bare text line with no heading or skeleton, unlike the sibling loading screens; icons in the tiles are emoji on hard-coded hex backgrounds (lead-forms/loading.tsx; page.tsx:29-31).
- **Verified evidence:** lead-forms/loading.tsx is 3 lines: page-main with a <p>Loading website lead forms…</p>, no heading/skeleton unlike lead-scoring/loading.tsx. page.tsx:29-31 use emoji icons with #e0f2fe/#dcfce7/#fee2e2 backgrounds (same StatCard pattern as HEALTH-06).
- **Files to change:** `apps/web/src/app/(app)/crm/lead-forms/loading.tsx`, `apps/web/src/app/(app)/crm/lead-forms/page.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx as header + 3 stat skeletons + table skeleton using shared Skeleton.
  2. Apply StatIcon tone tokens (see GAP-CRM-HEALTH-06).
- **Acceptance:**
  - Loading matches loaded layout (3 tiles + table).
  - No hex in page.tsx.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-HEALTH-06


---
## /crm/lead-reason-codes  —  `crm/lead-reason-codes.html`

- **Source:** `apps/web/src/app/(app)/crm/lead-reason-codes/page.tsx`
- **Design reference:** `redesign/crm/lead-reason-codes.html`

### GAP-CRM-LEAD-REASON-CODES-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed load the editor shows 'No reason codes yet' and an enabled 'Save reason codes'; the empty branch is not gated on source==='error', so saving from that view PUTs {codes: []} and can erase the tenant's whole reason taxonomy, contradicting the header comment 'never fabricate an empty list as fact' (ReasonCodesEditor.tsx:3-6, 99, 104-110, 162-164).
- **Verified evidence:** ReasonCodesEditor.tsx:42-46 setCodes(data) with data=[] on error (leadQualification getReasonCodes returns {data:[],source:'error'}); :99 shows badge, :104-109 renders 'No reason codes yet' regardless of source, and :162-164 Save is enabled (only busy disables). save() (:69-85) passes the empty-array check (every() on []) and saveReasonCodes PUTs {codes} (leadQualification.ts:331-337). Whether the server rejects an empty list is cannot-verify, so erase is plausible. Adding one row then saving on an errored load also overwrites the taxonomy with a single row.
- **Files to change:** `apps/web/src/app/_components/crm/ReasonCodesEditor.tsx`
- **Fix steps:**
  1. Add if(source==='error') branch returning ErrorState with onRetry={()=>void load()} (client editor, so use ErrorState not RefreshErrorState) and no Save button.
  2. Track loadedOk in state; disable Save and Add when !loadedOk.
  3. Server: reject empty list unless ?allowEmpty=true or send explicit expected version.
- **Acceptance:**
  - Test: getReasonCodes -> error; Save button absent/disabled; no PUT fired.
  - Retry after recovery loads rows.
  - Genuine empty (source api) still allows adding.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** High data-loss path on shared taxonomy; fix before release.
- **Depends on:** GAP-CRM-LEAD-REASON-CODES-04

### GAP-CRM-LEAD-REASON-CODES-02  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Remove deletes a code locally with no confirmation, and the PUT replaces the whole list, so a code already recorded against leads can disappear; 'Active: Off' is the safe path but nothing says so (editor:64-67, 152).
- **Verified evidence:** removeCode (:64-67) drops the row locally with no confirm (button :152). Nothing is deleted server-side until Save PUTs the whole list (leadQualification.ts:331-337), so the loss is reversible by reload; the risk is that Save silently persists removals of codes already referenced by leads. Whether backend blocks removal of in-use codes is cannot-verify. Active toggle exists (:145-149) but no hint recommends it.
- **Files to change:** `apps/web/src/app/_components/crm/ReasonCodesEditor.tsx`
- **Fix steps:**
  1. Track originalCodes; on Save compute removed codes and open ds ConfirmDialog listing them ('N codes will be removed; existing leads keep the code text; prefer switching Active off').
  2. Add helper text under table about Active Off.
  3. Backend: reject or soft-delete codes in use.
- **Acceptance:**
  - Removing a loaded code then Save shows confirm listing it; Cancel aborts PUT.
  - No dialog when nothing removed.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium; shared taxonomy.
- **Depends on:** ConfirmDialog

### GAP-CRM-LEAD-REASON-CODES-03  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Only Code is validated: Label may be blank (the picker would show an empty option) and duplicate codes are allowed (editor:72, 137).
- **Verified evidence:** save() validates only c.code.trim() (:72); label input (:137) has no required check or aria-invalid; no duplicate detection (codes are upper-cased at :130 but not compared). Server-side validators cannot-verify.
- **Files to change:** `apps/web/src/app/_components/crm/ReasonCodesEditor.tsx`, `apps/web/src/lib/crm/leadQualification.ts`
- **Fix steps:**
  1. Add zod reasonCodesSchema (code regex /^[A-Z0-9_]+$/, label min 1, refine unique code per appliesToStatus).
  2. Run safeParse in save(); map issues to row aria-invalid and inline messages.
  3. Reuse schema in saveReasonCodes.
- **Acceptance:**
  - Blank label blocks Save with message.
  - Two rows with same code block Save.
  - Valid list saves.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-LEAD-REASON-CODES-04  ·  MEDIUM  ·  partly  ·  theme CONCURRENCY (was WIRING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Same wholesale-PUT design as other list editors: no version token, so concurrent admins overwrite each other; no audit trail is visible on the page even though the empty-state copy promises 'consistent, auditable' reasons (editor:70-88, 108).
- **Verified evidence:** Whole-list PUT with no version/etag: saveReasonCodes sends only {codes} (leadQualification.ts:331-337); load at :40-47 keeps no version. No audit trail UI; empty-state copy :108 says 'consistent, auditable reason' (copy refers to the reasons captured on leads, not to edits of this list). Whether crm-service audits/locks is cannot-verify. Theme WIRING is off.
- **Files to change:** `apps/web/src/app/_components/crm/ReasonCodesEditor.tsx`, `apps/web/src/lib/crm/leadQualification.ts`
- **Fix steps:**
  1. Backend: return version/updatedAt on GET and require If-Match on PUT (409 on mismatch).
  2. Store version in editor state, send it, and on 409 show 'changed by another admin, reload'.
  3. Add 'Last changed by/at' line from response metadata if provided; link to audit log.
- **Acceptance:**
  - Two sessions: second save gets conflict message, no overwrite.
  - Success updates version.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium.
- **Depends on:** GAP-CRM-LEAD-REASON-CODES-01

### GAP-CRM-LEAD-REASON-CODES-05  ·  LOW  ·  confirmed  ·  theme COPY (was STATUS)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The same screen is 'Lead Stage Reasons' (page title), 'Reason codes' (card) and 'Lead Reason Codes' (loading.tsx and error area); the status dropdown shows raw enum text such as 'disqualified' (page.tsx:9; loading.tsx; editor:141).
- **Verified evidence:** Names: page.tsx:9 'Lead Stage Reasons'; editor h3 :98 'Reason codes'; loading.tsx:6 h1 'Lead Reason Codes'; error.tsx:12 area 'CRM Lead Reason Codes'; hub tile 'Lead Stage Reasons'. Status option renders raw enum s (:142); LEAD_STATUSES are lowercase (leadQualification.ts:18+). Not a StatusPill issue.
- **Files to change:** `apps/web/src/app/(app)/crm/lead-reason-codes/page.tsx`, `apps/web/src/app/(app)/crm/lead-reason-codes/loading.tsx`, `apps/web/src/app/(app)/crm/lead-reason-codes/error.tsx`, `apps/web/src/app/_components/crm/ReasonCodesEditor.tsx`
- **Fix steps:**
  1. Pick 'Lead Stage Reasons' and use in loading h1, error area, card title.
  2. Add LEAD_STATUS_LABEL map in leadQualification.ts and use in the select option text (value stays raw).
  3. Consider reusing for LeadTransitionControl.
- **Acceptance:**
  - All headings equal 'Lead Stage Reasons'.
  - Select shows 'Disqualified' etc.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-LEAD-REASON-CODES-06  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx draws four stat tiles and a 280px block that the loaded page never shows, and the table has no mobile transform (lead-reason-codes/loading.tsx; editor:111-119).
- **Verified evidence:** loading.tsx:9-16 renders 4 stat tiles + 280px block while the loaded page has PageHeader and one card (page.tsx, editor :96). Mobile claim is unverified: editor uses plain table.tbl (:111); whether global CSS provides a responsive transform is cannot-verify without stylesheet review.
- **Files to change:** `apps/web/src/app/(app)/crm/lead-reason-codes/loading.tsx`, `apps/web/src/app/_components/crm/ReasonCodesEditor.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx to header + single card skeleton (no stat tiles); share one component with lead-scoring/loading.tsx.
  2. Wrap table in overflow-x-auto or card-per-row layout below sm breakpoint.
- **Acceptance:**
  - Loading has no stat tiles.
  - At 375px width no horizontal page scroll.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /crm/lead-scoring  —  `crm/lead-scoring.html`

- **Source:** `apps/web/src/app/(app)/crm/lead-scoring/page.tsx`
- **Design reference:** `redesign/crm/lead-scoring.html`

### GAP-CRM-LEAD-SCORING-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed load the editor shows 'No scoring rules yet' with an enabled 'Save rules'; the empty branch is not gated on source==='error', so saving from that view PUTs {rules: []} and can switch off automatic scoring for every lead, contradicting the header comment 'never fabricate an empty rule set as fact' (LeadScoreRulesEditor.tsx:3-8, 147-158, 236-239).
- **Verified evidence:** Same as reason codes: LeadScoreRulesEditor.tsx:83-90 sets rows=[] on error (getScoreRules returns {data:[],source:'error'}, leadQualification.ts ~236-242); :147 badge; :152-157 'No scoring rules yet'; Save (:237-239) enabled; save() passes rows.every on [] and PUTs {rules:[]} (saveScoreRules :248-254). Server behaviour on empty rules cannot-verify.
- **Files to change:** `apps/web/src/app/_components/crm/LeadScoreRulesEditor.tsx`
- **Fix steps:**
  1. Add error branch with ErrorState onRetry={()=>void load()} and no Save/Add.
  2. Track loadedOk; disable Save when false.
  3. Backend: refuse empty rule set without explicit flag.
- **Acceptance:**
  - Error load: no Save control, no PUT.
  - Retry restores editor.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** High: could disable scoring for all leads.
- **Depends on:** GAP-CRM-LEAD-REASON-CODES-01

### GAP-CRM-LEAD-SCORING-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Params is a raw JSON text box with no schema, example per score function or preview; admins must know the params contract of linear/step/boolean (opaque Record<string, unknown>) to configure a rule, and the only guard is 'is a JSON object' (editor:45-54, 213-216; lib/crm/leadQualification.ts:196-202).
- **Verified evidence:** Params is a plain text input (LeadScoreRulesEditor.tsx:208-217, placeholder '{"max":100}'); parseParams (:45-54) only checks JSON object; type is Record<string, unknown> (leadQualification.ts:196-202). Param contract per linear/step/boolean is in crm-service, cannot-verify.
- **Files to change:** `apps/web/src/app/_components/crm/LeadScoreRulesEditor.tsx`, `apps/web/src/lib/crm/leadQualification.ts`
- **Fix steps:**
  1. Confirm params contract with backend and define zod schemas per scoreFnType (discriminated union).
  2. Replace text box with structured inputs (linear: min/max; step: threshold rows; boolean: none) and show example under selector.
  3. Keep a 'Advanced JSON' fallback.
  4. Validate against schema in rowValid().
- **Acceptance:**
  - Selecting 'step' shows threshold editor.
  - Invalid params blocked with per-field message.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; wrong params silently mis-score leads.

### GAP-CRM-LEAD-SCORING-03  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Attribute is a free-text string with a single placeholder ('e.g. industry'); nothing validates it against real lead fields or custom fields, so a typo saves a rule that never scores (editor:178-183).
- **Verified evidence:** Attribute input (:177-184) is free text with placeholder 'e.g. industry'; rowValid only requires non-empty (:58). No source of valid attributes in the file. Theme FABRICATED is wrong (no fake data); it is validation.
- **Files to change:** `apps/web/src/app/_components/crm/LeadScoreRulesEditor.tsx`
- **Fix steps:**
  1. Backend/decision: expose list of scoreable lead fields incl. custom fields (custom-fields endpoint).
  2. Replace input with select/combobox (SmartCombobox) from that list, with free text disabled.
  3. Warn on unknown attribute.
- **Acceptance:**
  - Unknown attribute rejected on save.
  - Custom field appears in list.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low-medium.

### GAP-CRM-LEAD-SCORING-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Weights are independent 0-100 numbers with no total, normalisation hint, or preview of the resulting score distribution; the change applies to every lead after Save with no impact summary (editor:164, 236-239).
- **Verified evidence:** Weight inputs (:197-207) are int 0-100 each; no sum, normalisation hint or preview; Save (:235-240) applies to all leads per note. Preview needs backend.
- **Files to change:** `apps/web/src/app/_components/crm/LeadScoreRulesEditor.tsx`
- **Fix steps:**
  1. Show running total and share % per rule beside each weight.
  2. Confirm dialog before Save stating rules apply to all leads.
  3. Backend: dry-run endpoint returning score distribution; render summary.
- **Acceptance:**
  - Total updates as weights edit.
  - Confirm dialog appears.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium.

### GAP-CRM-LEAD-SCORING-05  ·  MEDIUM  ·  partly  ·  theme CONCURRENCY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Whole-list PUT with no version token and no visible audit trail: two admins overwrite each other and there is no record on this page of who changed which weight (lib/crm/leadQualification.ts:249-255).
- **Verified evidence:** saveScoreRules (leadQualification.ts:248-254) PUTs {rules} with no version; editor holds none. Audit trail absence on page is true; backend audit cannot-verify.
- **Files to change:** `apps/web/src/app/_components/crm/LeadScoreRulesEditor.tsx`, `apps/web/src/lib/crm/leadQualification.ts`
- **Fix steps:**
  1. Same optimistic-concurrency scheme as GAP-CRM-LEAD-REASON-CODES-04 (version + If-Match).
  2. Show 'Last changed by/at' and link to audit log.
- **Acceptance:**
  - Concurrent save returns conflict message.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium.
- **Depends on:** GAP-CRM-LEAD-REASON-CODES-04

### GAP-CRM-LEAD-SCORING-06  ·  LOW  ·  partly  ·  theme DEFAULTS (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** A new rule defaults to weight 1 on a 0-100 scale, so it is effectively inert until edited (editor:104).
- **Verified evidence:** addRule (:104) sets weight 1 (valid 0-100 int). 'Effectively inert' depends on how the server normalises weights (cannot-verify); relative to other rules it is low, not zero. Theme DEADROUTE is wrong.
- **Files to change:** `apps/web/src/app/_components/crm/LeadScoreRulesEditor.tsx`
- **Fix steps:**
  1. Start new rules with blank weight (NaN, forcing entry) or a documented default e.g. 10.
  2. Mark rule aria-invalid until weight typed.
- **Acceptance:**
  - New rule cannot be saved until weight set.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-LEAD-SCORING-07  ·  LOW  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx shows four stat tiles and a 280px block the page never renders; Remove deletes a rule immediately with no confirmation (lead-scoring/loading.tsx; editor:108, 226).
- **Verified evidence:** lead-scoring/loading.tsx:9-16 4 tiles + 280px block; loaded page has no tiles. removeRule (:108) fires from button :226 with no confirm; local only until Save, so partly reversible.
- **Files to change:** `apps/web/src/app/(app)/crm/lead-scoring/loading.tsx`, `apps/web/src/app/_components/crm/LeadScoreRulesEditor.tsx`
- **Fix steps:**
  1. Share loading skeleton with reason-codes (see GAP-CRM-LEAD-REASON-CODES-06).
  2. Show removed-rule count in a ConfirmDialog on Save (same diff pattern as REASON-CODES-02).
- **Acceptance:**
  - Loading has no stat tiles.
  - Save after removal asks confirm.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-LEAD-REASON-CODES-06, GAP-CRM-LEAD-REASON-CODES-02


---
## /crm/linked-accounts  —  `crm/linked-accounts.html`

- **Source:** `apps/web/src/app/(app)/crm/linked-accounts/page.tsx`
- **Design reference:** `redesign/crm/linked-accounts.html`

### GAP-CRM-LINKED-ACCOUNTS-02  ·  MEDIUM  ·  confirmed  ·  theme STATUS (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Every status renders in the same 'pill info' regardless of value, so 'Needs attention' and 'Disconnected' look identical to 'Connected' (panel:157).
- **Verified evidence:** apps/web/src/app/_components/crm/LinkedAccountsPanel.tsx:157 renders every row as <span className="pill info">{STATUS_LABEL[a.status]}</span>; STATUS_LABEL (28-33) distinguishes pending/connected/error/revoked by text only. CSS has .pill.good/.warn/.bad/.mut variants unused here.
- **Files to change:** `apps/web/src/app/_components/crm/LinkedAccountsPanel.tsx`
- **Fix steps:**
  1. Add STATUS_TONE: Record<LinkedStatus,'warn'|'good'|'bad'|'mut'> (pending=warn, connected=good, error=bad, revoked=mut).
  2. Change line 157 to className={`pill ${STATUS_TONE[a.status]}`}.
  3. Prefix the label with a non-colour glyph or text cue (e.g. '! Needs attention') so status is not colour-only.
  4. Optional: extract a shared <StatusPill tone label/> in ds/ for reuse by onboarding lists.
- **Acceptance:**
  - Component test: render accounts with each of 4 statuses; assert pill class differs per status and text present.
  - Manual: an 'error' link shows a red/bad pill, 'connected' a green pill.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic only; no data or approval impact.

### GAP-CRM-LINKED-ACCOUNTS-03  ·  MEDIUM  ·  partly  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The button says 'Connect provider' although nothing is connected: the request stays pending and no items are imported; the honest wording is in small grey text above the form rather than on the action or in the success message beyond the first sentence (panel:105-108, 132).
- **Verified evidence:** Button label is 'Connect provider' (apps/web/src/app/_components/crm/LinkedAccountsPanel.tsx:132) while nothing syncs. But the honest wording exists: paragraph at 105-107 (13px muted, above the form) and the success message at 73 is the full sentence 'Connection requested. It is pending — automatic sync is not live yet.' so 'beyond the first sentence' is overstated. Strings are hardcoded English (no next-intl), so the I18N tag is loosely right but the real issue is copy.
- **Files to change:** `apps/web/src/app/_components/crm/LinkedAccountsPanel.tsx`
- **Fix steps:**
  1. Rename button to 'Request connection' (busy: 'Requesting…') and align heading 'Connect email & calendar' / message.
  2. Promote the 105-107 notice to a visible callout (role=note, not muted 13px) directly above the submit button.
  3. Move the panel strings into the project's message catalogue (lib/messages) or next-intl keys per repo convention.
  4. Keep the pending status label as is (line 29).
- **Acceptance:**
  - Component test: button accessible name is 'Request connection'.
  - Manual: success message and callout both state sync is not live.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Copy only.

### GAP-CRM-LINKED-ACCOUNTS-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** After a failed load the list says 'Connections unavailable' but the connect form stays enabled, so a user can add a link (possibly a duplicate) without seeing existing ones; duplicates for the same provider and email are not prevented client-side (panel:143-147, 114-134).
- **Verified evidence:** When getLinkedAccounts fails (source==='error', apps/web/src/app/_components/crm/LinkedAccountsPanel.tsx:143-146) the form (110-137) is still enabled; submit only checks EMAIL_RE (66) and busy. No client-side check for an existing provider+email (accounts state is empty on error, and even on success connect() at 72 does not compare). Whether the backend (v1/crm/linked-accounts, crm-service absent from snapshot) rejects duplicates: cannot verify.
- **Files to change:** `apps/web/src/app/_components/crm/LinkedAccountsPanel.tsx`
- **Fix steps:**
  1. Disable the Provider/Email/Submit controls while source==='loading' or 'error' and show a retry link in the error row.
  2. In connect(), before calling connectLinkedAccount, find an existing account with same provider and case-insensitive externalEmail (non-revoked) and set an error instead of posting.
  3. Add a Retry button in the 'Connections unavailable' row calling load().
  4. Ask backend to return 409 on duplicate (provider, tenant/user, external_email) and map it via errorMessageFromResponse.
- **Acceptance:**
  - Test: mock getLinkedAccounts -> error; submit button is disabled and Retry visible.
  - Test: existing google/a@x.in; submitting same again shows duplicate error and no POST.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; server-side uniqueness is the real guard. Theme is not PII: it is a failure-mask/validation issue.

### GAP-CRM-LINKED-ACCOUNTS-05  ·  LOW  ·  confirmed  ·  theme LOADING (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The DataSourceBadge is shown twice on failure (card header and inline) (panel:102, 145).
- **Verified evidence:** DataSourceBadge source="error" is rendered in the card header (apps/web/src/app/_components/crm/LinkedAccountsPanel.tsx:102) and again inside the 'Connections unavailable' paragraph (145).
- **Files to change:** `apps/web/src/app/_components/crm/LinkedAccountsPanel.tsx`
- **Fix steps:**
  1. Remove the inline badge at line 145 (keep header badge) and replace with a Retry button.
- **Acceptance:**
  - Render with error source: exactly one DataSourceBadge in DOM.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CRM-LINKED-ACCOUNTS-04

### GAP-CRM-LINKED-ACCOUNTS-06  ·  LOW  ·  confirmed  ·  theme LOADING (was PII)

- [x] **Status** (W0 2026-10-13 closed by #1860, verified on main 9c5e9e9e9; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** The screen is 'Connected Accounts' (page), 'Connect email & calendar' (card) and 'Linked Accounts' (loading.tsx, route, error area); loading.tsx also draws four stat tiles the page never shows (linked-accounts/loading.tsx).
- **Verified evidence:** Title inconsistency verified: page.tsx PageHeader title 'Connected Accounts'; card h3 'Connect email & calendar' (apps/web/src/app/_components/crm/LinkedAccountsPanel.tsx:101); loading.tsx h1 'Linked Accounts' and 4 stat-tile skeletons + 280px block that the page never renders (page is one card with form+table); error.tsx area='CRM Linked Accounts'. Not a PII issue.
- **Files to change:** `apps/web/src/app/(app)/crm/linked-accounts/loading.tsx`, `apps/web/src/app/(app)/crm/linked-accounts/error.tsx`, `apps/web/src/app/(app)/crm/linked-accounts/page.tsx`
- **Fix steps:**
  1. Choose one name ('Connected Accounts') and use it in loading.tsx h1, error.tsx area, and nav/breadcrumb.
  2. Rewrite loading.tsx skeleton: header, one card with 2 input skeletons + button + 3 table-row skeletons; drop the 4 tile grid.
  3. Keep card h3 as a section label ('Connect a mailbox or calendar').
- **Acceptance:**
  - Visit route with throttled network: skeleton shape matches loaded layout, no layout shift.
  - Grep: 'Linked Accounts' no longer appears in this segment.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /crm/onboarding  —  `crm/onboarding.html`

- **Source:** `apps/web/src/app/(app)/crm/onboarding/page.tsx`
- **Design reference:** `redesign/crm/onboarding.html`

### GAP-CRM-ONBOARDING-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The list identifies a case only by the first 8 characters of a record id; Account is likewise an id fragment and the deal is not shown, so a clerk cannot tell which customer a row is without opening it (OnboardingList.tsx:30-32, 114, 122).
- **Verified evidence:** apps/web/src/app/(app)/crm/onboarding/OnboardingList.tsx:30-32 shortId slices to 8 chars; used for case link text (114) and Account (122); no deal column; model has no names (lib/crm/onboarding.ts:195-208). Clerks cannot tell customers apart.
- **Files to change:** `apps/web/src/app/(app)/crm/onboarding/OnboardingList.tsx`, `apps/web/src/lib/crm/onboarding.ts`
- **Fix steps:**
  1. Backend: include accountName and dealName in GET /v1/crm/onboarding-cases rows (or web batch-resolve).
  2. Add fields to OnboardingCase/normaliseCase.
  3. Replace 'Case' column with customer/deal name link (client-side <Link>), keep short ref as secondary muted text.
  4. Show Account as name; drop shortId for account.
- **Acceptance:**
  - Component test: row shows 'Acme Corp' and link to /crm/onboarding/{id}.
  - No 8-char UUID fragments visible as primary identifiers.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-ONBOARDING-DETAIL-01

### GAP-CRM-ONBOARDING-02  ·  MEDIUM  ·  partly  ·  theme LIST (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Hand-rolled table with no sort, search, pagination or export (unlike the DataTable lists elsewhere in CRM); the request has no limit or page and the UI has none, so a long case list is unbounded (OnboardingList.tsx:97-128; lib/crm/onboarding.ts:266-277).
- **Verified evidence:** Hand-rolled <table className="tbl"> (apps/web/src/app/(app)/crm/onboarding/OnboardingList.tsx:97-128) with no sort/search/paging/export; getOnboardingCases sends only stage/accountId, no limit/page (apps/web/src/lib/crm/onboarding.ts:261-277). True. Not a PII/masking issue (theme wrong). A shared DataTable exists (app/_components/ds/DataTable.tsx). Whether backend caps result size is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/crm/onboarding/OnboardingList.tsx`, `apps/web/src/lib/crm/onboarding.ts`
- **Fix steps:**
  1. Migrate table to ds/DataTable with columns Customer, Stage, KYC, Updated and client sort.
  2. Add search box and page/limit params to getOnboardingCases once backend supports them (confirm).
  3. Add CSV export only if role-gated and audited.
- **Acceptance:**
  - Test: 150 cases paged with 25/page controls.
  - Sort by Updated toggles order.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Unbounded fetch may slow large tenants; export needs audit.
- **Depends on:** GAP-CRM-ONBOARDING-01

### GAP-CRM-ONBOARDING-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Filtering is by stage only; KYC status is the gate for completion but cannot be filtered, and there is no age-in-stage or overdue signal beyond a full timestamp in 'Updated' (OnboardingList.tsx:35, 104, 123).
- **Verified evidence:** Only a stage select (apps/web/src/app/(app)/crm/onboarding/OnboardingList.tsx:59-74); ListFilters has stage/accountId only (lib:261-264); Updated is a full timestamp (123) with no age/overdue cue. KYC filter/param not supported by client; backend support cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/crm/onboarding/OnboardingList.tsx`, `apps/web/src/lib/crm/onboarding.ts`
- **Fix steps:**
  1. Add KYC status select using KYC_STATUSES/KYC_LABELS.
  2. Send kycStatus param if the backend supports it, else filter client-side.
  3. Add 'Age in stage' column (days since updatedAt) with warn pill beyond a threshold (decision on SLA).
- **Acceptance:**
  - Test: choose KYC 'Submitted' -> only those rows.
  - Row older than SLA shows Overdue pill.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Threshold is a business decision.

### GAP-CRM-ONBOARDING-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The data-source badge is shown twice on failure (beside the filter and in the card) and the loading state is a bare text line (OnboardingList.tsx:75, 88; onboarding/loading.tsx).
- **Verified evidence:** Badge rendered at apps/web/src/app/(app)/crm/onboarding/OnboardingList.tsx:75 (filter row) and again at 88 (error paragraph) on failure; loading is a bare <p> at 82-85 and onboarding/loading.tsx is a text line, no skeleton. Error row also has no Retry.
- **Files to change:** `apps/web/src/app/(app)/crm/onboarding/OnboardingList.tsx`, `apps/web/src/app/(app)/crm/onboarding/loading.tsx`
- **Fix steps:**
  1. Remove badge at line 88 (keep 75) and add Retry button re-running the effect (bump a reload counter).
  2. Rewrite loading.tsx as header + filter + table-row skeleton.
- **Acceptance:**
  - Error state: one badge, Retry works.
  - Throttled load shows skeleton rows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-ONBOARDING-05  ·  LOW  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Updated' prints toLocaleString('en-IN') (dd/mm/yyyy with seconds) rather than the department date format; case links are plain anchors that cause full page loads (OnboardingList.tsx:24-28, 114).
- **Verified evidence:** fmtDate (apps/web/src/app/(app)/crm/onboarding/OnboardingList.tsx:24-28) uses toLocaleString('en-IN'); case link (114) is a raw <a href> (full navigation) not next/link.
- **Files to change:** `apps/web/src/app/(app)/crm/onboarding/OnboardingList.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Use shared IST date-time formatter (see DETAIL-07).
  2. Replace <a> with next/link <Link>.
- **Acceptance:**
  - Snapshot: 'dd Mon yyyy' format.
  - Clicking case link does not reload page (client nav).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CRM-ONBOARDING-DETAIL-07

### GAP-CRM-ONBOARDING-06  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Status uses emoji glyphs (🆕 📄 🔎 ⚙️ ✅ 🚫 / ⏳ 📤 ⛔) that render differently across platforms, although they are hidden from assistive tech and always paired with text (lib/crm/onboarding.ts:162-194).
- **Verified evidence:** Emoji icons in STAGE_META/KYC_META (apps/web/src/lib/crm/onboarding.ts:162-183) are rendered aria-hidden (OL:117,120) next to text labels, so accessibility is fine; the remaining issue is cross-platform rendering and inconsistency with other pills only. Low value.
- **Files to change:** `apps/web/src/lib/crm/onboarding.ts`, `apps/web/src/app/(app)/crm/onboarding/OnboardingList.tsx`, `apps/web/src/app/(app)/crm/onboarding/[id]/OnboardingDetail.tsx`
- **Fix steps:**
  1. Replace emoji with ds icon set or tone pills using the existing tone field.
  2. Keep text label.
- **Acceptance:**
  - Visual: same look on Windows/Android/macOS.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /crm/onboarding/[id]  —  `crm/onboarding-detail.html`

- **Source:** `apps/web/src/app/(app)/crm/onboarding/[id]/page.tsx`
- **Design reference:** `redesign/crm/onboarding-detail.html`

### GAP-CRM-ONBOARDING-DETAIL-01  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The card title is 'Case {full record id}' and Account and Deal are raw UUIDs with no names or links to /crm/accounts or the deal; the page title is a static 'Onboarding Case', so the customer being onboarded is never named (OnboardingDetail.tsx:246, 256-257; page.tsx:8).
- **Verified evidence:** apps/web/src/app/(app)/crm/onboarding/[id]/OnboardingDetail.tsx:246 <h3>Case {item.id}</h3> prints the full id; 256-257 print item.accountId and item.dealId raw with no link or name. page.tsx:8 PageHeader title is static 'Onboarding Case'. OnboardingCase model (lib/crm/onboarding.ts:195-208) carries only ids, no customer name. Account/deal name lookup endpoints not visible in this snapshot (crm-service absent).
- **Files to change:** `apps/web/src/app/(app)/crm/onboarding/[id]/OnboardingDetail.tsx`, `apps/web/src/app/(app)/crm/onboarding/[id]/page.tsx`, `apps/web/src/lib/crm/onboarding.ts`
- **Fix steps:**
  1. Backend: enrich GET /v1/crm/onboarding-cases(/:id) with accountName and dealName (or fetch via existing accounts/deals getters if present).
  2. Add accountName/dealName to OnboardingCase and normaliseCase.
  3. In OnboardingDetail replace h3 with 'Onboarding — {accountName||dealName}' and show ids as small muted 'Ref' (formatInternalRef from lib/formatters).
  4. Render Account and Deal fields as <Link href=/crm/accounts/[id]> (and deal link) with name text; fall back to '—' not raw UUID.
  5. Make page title dynamic (generateMetadata or client heading) once name loads.
- **Acceptance:**
  - Component test: case with accountName 'Acme' shows 'Acme' link and no UUID text.
  - Manual: header names the customer; UUID only in URL.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; risk is a broken link if account route is missing.

### GAP-CRM-ONBOARDING-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The KYC panel records only a status: applyKyc sends {status, version} although recordKyc accepts a `reference`, so the 'KYC reference' field shown on the case can never be captured from this screen (OnboardingDetail.tsx:134, 258; lib/crm/onboarding.ts:326-350).
- **Verified evidence:** applyKyc apps/web/src/app/(app)/crm/onboarding/[id]/OnboardingDetail.tsx:134 calls recordKyc(item.id,{status, version}); RecordKycInput has optional reference (apps/web/src/lib/crm/onboarding.ts:326-330) and recordKyc forwards it (339-346), but no input exists in the UI, while 'KYC reference' is displayed at 258. Backend contract for reference cannot be verified (crm-service absent).
- **Files to change:** `apps/web/src/app/(app)/crm/onboarding/[id]/OnboardingDetail.tsx`
- **Fix steps:**
  1. Add state kycReference and an <input> 'KYC reference' in the KYC panel, shown when kycTarget is 'submitted' or 'verified'.
  2. Validate non-empty/trimmed (max length per backend) before beginKyc; require it for 'verified'.
  3. Pass reference in recordKyc(item.id,{status,reference,version}).
  4. Clear field after success; show reference in ConfirmDialog description.
- **Acceptance:**
  - Test: choose 'Submitted', enter ref 'KYC-123', confirm; recordKyc called with reference.
  - Manual: reference appears in the read-only KYC reference field after reload.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** KYC record integrity; confirm with backend whether reference is mandatory for verified.
- **Depends on:** GAP-CRM-ONBOARDING-DETAIL-05

### GAP-CRM-ONBOARDING-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Recording verified or rejected is offered to every CRM role and says 'requires an approver role'; the refusal only arrives as a 403 after the confirm dialog (OnboardingDetail.tsx:276-278, 391-402).
- **Verified evidence:** KYC panel text at apps/web/src/app/(app)/crm/onboarding/[id]/OnboardingDetail.tsx:276-278 says verified/rejected 'requires an approver role'; kycNextOptions (117) offers verified/rejected to anyone; the 403 is only surfaced via applyKyc catch (143-144) after ConfirmDialog (391-401). Layout gate is CRM_ROLES only ('crm_user','crm_admin','platform_admin','super_admin', crm/layout.tsx:5). Which roles are 'approver' in crm-service: cannot verify. Client roles are only readable server-side via getSessionRoles() (lib/auth/roleGuard.ts:26).
- **Files to change:** `apps/web/src/app/(app)/crm/onboarding/[id]/OnboardingDetail.tsx`, `apps/web/src/app/(app)/crm/onboarding/[id]/page.tsx`, `apps/web/src/lib/crm/onboarding.ts`
- **Fix steps:**
  1. Decide the approver role set (e.g. crm_admin) with backend; export CRM_KYC_APPROVER_ROLES constant.
  2. In page.tsx (server) call getSessionRoles() and pass canApproveKyc prop to OnboardingDetail.
  3. When !canApproveKyc filter verified/rejected out of kycNextOptions (allow 'submitted' only) and show note 'Verification needs an approver'.
  4. Keep the 403 catch as backstop.
- **Acceptance:**
  - Test: canApproveKyc=false with status submitted -> no verified/rejected options.
  - Test: canApproveKyc=true -> both offered.
  - Backend still returns 403 to non-approvers (unchanged).
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Approval control: UI hiding must not replace server enforcement; wrong role list could block legitimate approvers.

### GAP-CRM-ONBOARDING-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed load the EmptyState says 'Try again in a moment' but offers no retry control, so the clerk must reload the browser (OnboardingDetail.tsx:221-235).
- **Verified evidence:** apps/web/src/app/(app)/crm/onboarding/[id]/OnboardingDetail.tsx:221-235: on isError with item==null, EmptyState says 'Try again in a moment' but has no action prop, no retry (reload exists at 107 but unused). Note not-found is separated correctly (getOnboardingCase returns 'not-found' on 404, lib:286).
- **Files to change:** `apps/web/src/app/(app)/crm/onboarding/[id]/OnboardingDetail.tsx`
- **Fix steps:**
  1. Pass EmptyState an action (or use ErrorState from ds) with a Retry Button calling reload().
  2. Keep separate copy for source==='not-found' with back link to /crm/onboarding.
  3. Remove duplicate badge if ErrorState is used.
- **Acceptance:**
  - Test: mock 500 -> Retry button present; clicking calls getOnboardingCase again and renders case.
  - Test: 404 -> 'not found', no retry.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** RefreshErrorState (server variant; here client reload() is the right retry)

### GAP-CRM-ONBOARDING-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The KYC reference and verification time are shown in full to every CRM role with no masking or role gate (DPDP-sensitive KYC data), and there is no stage/KYC history or audit view on the case (OnboardingDetail.tsx:258-259).
- **Verified evidence:** apps/web/src/app/(app)/crm/onboarding/[id]/OnboardingDetail.tsx:258-259 show kycReference and kycVerifiedAt in clear to anyone passing the CRM layout gate. True. No stage/KYC history or audit section exists on the page (only current values). Whether kycReference is actually sensitive (e.g. PAN/Aadhaar number vs. an internal ticket id) cannot be verified; no <Masked> component exists in the repo (grep found none), so it would need creating.
- **Files to change:** `apps/web/src/app/(app)/crm/onboarding/[id]/OnboardingDetail.tsx`, `apps/web/src/app/_components/ds/Masked.tsx`
- **Fix steps:**
  1. Decision: classify kycReference (identifier vs. document number).
  2. Create ds/Masked (mask all but last 4, reveal button gated by prop canReveal, logs reveal via audit endpoint).
  3. Use <Masked> for KYC reference in OnboardingDetail.
  4. Add a history card once backend exposes stage/KYC events (audit trail); cannot be built from current API.
- **Acceptance:**
  - Test: reference '1234567890' renders '••••••7890' by default.
  - Reveal requires canReveal and fires audit call (backend).
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure if reference holds Aadhaar/PAN; over-masking may hamper verification work.
- **Depends on:** GAP-CRM-ONBOARDING-DETAIL-03

### GAP-CRM-ONBOARDING-DETAIL-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Accepted (202) mutations show 'may take a moment to take effect' but the case is reloaded immediately, so the panel can still show the old stage or KYC status (OnboardingDetail.tsx:107-109, 136-143, 192-199).
- **Verified evidence:** applyKyc (137-142) and applyStage (192-199) show 'may take a moment to take effect' when result.accepted (HTTP 202) then immediately call reload(), so the fetched case may still be stale; no polling. Stage/KYC selects reset, so the user sees old values with a success message.
- **Files to change:** `apps/web/src/app/(app)/crm/onboarding/[id]/OnboardingDetail.tsx`
- **Fix steps:**
  1. When accepted, show the message plus a 'Pending update' state and poll getOnboardingCase up to N times (e.g. 3 x 2s) until version/stage/kycStatus changes.
  2. Disable both action panels while pending to prevent version-conflict double submits.
  3. Fall back to a manual 'Refresh' button after polling ends.
- **Acceptance:**
  - Test with fake timers: 202 response then case unchanged on first reload, updated on second -> UI updates without user action.
  - Panels disabled while pending.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; avoid duplicate transitions from stale version.

### GAP-CRM-ONBOARDING-DETAIL-07  ·  LOW  ·  confirmed  ·  theme DATEFMT (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Timestamps use toLocaleString('en-IN'); stage, KYC and Version are shown as bare values, and the raw version number is exposed to clerks (OnboardingDetail.tsx:47-51, 263).
- **Verified evidence:** fmtDate (apps/web/src/app/(app)/crm/onboarding/[id]/OnboardingDetail.tsx:47-51) uses d.toLocaleString('en-IN') (browser timezone, includes seconds) instead of shared formatIndianDate (lib/formatters.ts:2). Version shown as bare 'Version' field at 263. Stage/KYC are icon+label (251,254), not styled badges.
- **Files to change:** `apps/web/src/app/(app)/crm/onboarding/[id]/OnboardingDetail.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Replace fmtDate with a shared formatIndianDateTime (add to lib/formatters.ts, IST, dd Mon yyyy, hh:mm) and use for 5 date fields.
  2. Remove the Version field from the visible grid (keep internal for optimistic lock) or move to a collapsed 'Technical details'.
  3. Render stage/KYC as tone pills using STAGE_META/KYC_META tone.
- **Acceptance:**
  - Unit test formatIndianDateTime('2026-01-05T20:00:00Z') -> '06 Jan 2026, 01:30 IST'.
  - Manual: Version no longer visible in main grid.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CRM-ONBOARDING-05


---
## /crm/opportunities  —  `crm/opportunities.html`

- **Source:** `apps/web/src/app/(app)/crm/opportunities/page.tsx`
- **Design reference:** `redesign/crm/opportunities.html`

### GAP-CRM-OPPORTUNITIES-02  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Two different boards run over the same deals: /crm/pipeline uses drag-and-drop with no confirmation, sends stage name + probability, and hides the pipeline picker, while this page uses a select + ConfirmDialog and sends stage key + version; users get different guarantees per screen (OpportunityViews.tsx:225, pipeline/_components/KanbanBoard.tsx:80).
- **Verified evidence:** OpportunityViews board uses a per-card select + ConfirmDialog (OV:224-233, 355-367) and changeOpportunityStage sends {stage key, version} (apps/web/src/lib/crm/opportunity.ts:305-319). /crm/pipeline KanbanBoard (app/(app)/crm/pipeline/_components/KanbanBoard.tsx ~107-130) applies optimistic update on drop, no ConfirmDialog (grep), and PATCHes {stage name, stageId?, probability, version} to deals/:id/stage; it has no pipeline picker. Different contracts (probability from the stage vs. none).
- **Files to change:** `apps/web/src/app/(app)/crm/pipeline/_components/KanbanBoard.tsx`, `apps/web/src/app/_components/crm/OpportunityViews.tsx`
- **Fix steps:**
  1. Decide which board is canonical (recommend pipeline board); remove or link the other.
  2. Align both to a single client function changeOpportunityStage(id,stageKey,version) and one payload.
  3. Add confirm (or undo toast) plus mandatory-fields handling in the drag path.
  4. Add pipeline picker to the pipeline board.
- **Acceptance:**
  - Test: dropping a card triggers the same confirm and same PATCH body as the select path.
  - Both boards produce identical audit entries.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Stage moves affect forecast; probability handling must be settled with backend.

### GAP-CRM-OPPORTUNITIES-03  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 closed by #1859; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: Close gated by CRM_OPPORTUNITY_CLOSE_ROLES; a won close needs a 10-character reason; the dialog is now ds/Modal)
- **First-pass claim:** Close is offered on every open row to any CRM_ROLES user (crm_user included) with no role gate, and a Won close only needs a 1-character reason (CloseOpportunityDialog.tsx:67, crm/layout.tsx:5).
- **Verified evidence:** List shows a Close button for every non-closed row (apps/web/src/app/_components/crm/OpportunityViews.tsx:283-289) with no role check; the layout admits crm_user (crm/layout.tsx:5). CloseOpportunityDialog reasonMin = outcome==='won'?1:10 (67), comment says backend mirrors this (server enforcement cannot be verified, crm-service absent).
- **Files to change:** `apps/web/src/app/_components/crm/CloseOpportunityDialog.tsx`, `apps/web/src/app/_components/crm/OpportunityViews.tsx`, `apps/web/src/app/(app)/crm/opportunities/page.tsx`
- **Fix steps:**
  1. Decide who may close (owner / crm_admin) and won-reason policy.
  2. Pass canClose from server page via getSessionRoles(); hide/disable the Close button otherwise.
  3. Raise won reason minimum to 10 in reasonMin.
  4. Confirm backend enforces role and reason length.
- **Acceptance:**
  - Test: crm_user w/o permission sees no Close button.
  - Test: won with 1-char reason blocked.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Closing won deals affects revenue reporting; irreversible.

### GAP-CRM-OPPORTUNITIES-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed views render an EmptyState whose title is the bare character "—", while the badge says "Couldn't load — showing nothing"; the row-level message "could not be loaded just now" gives no retry action (OpportunityViews.tsx:200,216).
- **Verified evidence:** Failed views use <EmptyState title="—" message="…could not be loaded just now."> (apps/web/src/app/_components/crm/OpportunityViews.tsx:205,257,301,323 - finding said 200,216) with no retry; header badge shows separately (189). Retry could call reload().
- **Files to change:** `apps/web/src/app/_components/crm/OpportunityViews.tsx`
- **Fix steps:**
  1. Create small ViewError component (title 'Couldn't load the board', Retry -> reload()) and use in 4 views.
  2. Show '—' only for values, not as a title.
- **Acceptance:**
  - Test: mock failure -> Retry button; click re-fetches and renders data.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-OPPORTUNITIES-05  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The calendar view issues a second full kanban fetch (same endpoint as the board) instead of a dedicated route, and a Board→Calendar switch refetches all deals; deals without expectedCloseDate silently vanish from it (lib/crm/opportunity.ts:446-470).
- **Verified evidence:** getCalendar (apps/web/src/lib/crm/opportunity.ts:446-470) fetches v1/crm/deals/kanban, the same endpoint as getKanban, and reload() refetches on each view switch (OV:78-101). But this is documented and deliberate (no calendar route exists); normaliseCalendar drops deals without expectedCloseDate (line ~437) also deliberately. Real gap: calendar empty text says 'No opportunities have an expected close date' though only some may lack one, and no count of omitted deals is shown.
- **Files to change:** `apps/web/src/app/_components/crm/OpportunityViews.tsx`, `apps/web/src/lib/crm/opportunity.ts`
- **Fix steps:**
  1. Cache kanban result in OpportunityViews state and derive calendar from it without refetch (per pipeline).
  2. Show 'N deals have no close date' note.
  3. Add backend calendar route later if needed.
- **Acceptance:**
  - Test: Board->Calendar issues no second request.
  - Note shows count of undated deals.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-OPPORTUNITIES-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Board cards are not links: the opportunity name cannot be opened, and no detail/edit route exists in this segment even though OpportunityForm supports edit (OpportunityViews.tsx:216, OpportunityForm.tsx:36).
- **Verified evidence:** Board cards (apps/web/src/app/_components/crm/OpportunityViews.tsx:218-220) and list rows (277) render name as plain text; app/(app)/crm/opportunities has only new/ (no [id]); OpportunityForm is imported only by new/page.tsx and its edit mode (opportunity prop) is unreachable.
- **Files to change:** `apps/web/src/app/_components/crm/OpportunityViews.tsx`, `apps/web/src/app/(app)/crm/opportunities/[id]/page.tsx`, `apps/web/src/app/(app)/crm/opportunities/[id]/edit/page.tsx`
- **Fix steps:**
  1. Add [id] route loading a deal (needs GET deals/:id, endpoint existence cannot be verified) and rendering OpportunityForm with opportunity.
  2. Link names in board and list with next/link.
  3. Add error/loading files following segment convention.
- **Acceptance:**
  - Click a card name opens edit form with prefilled values; save PATCHes.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Edit of value/stage bypasses stage-move gate unless PATCH enforces it.

### GAP-CRM-OPPORTUNITIES-07  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Board container scrolls horizontally with fixed 240px columns and no column value totals, unlike /crm/pipeline which shows per-stage value (OpportunityViews.tsx:212).
- **Verified evidence:** Board columns fixed minWidth/flex 240px inside overflowX:auto (apps/web/src/app/_components/crm/OpportunityViews.tsx:209-211); header shows only stageName and deal count (213-215); /crm/pipeline StageColumn shows totalValue via formatMoney. Totals can be summed client-side from col.deals valueMinor using BigInt.
- **Files to change:** `apps/web/src/app/_components/crm/OpportunityViews.tsx`
- **Fix steps:**
  1. Compute per-column total with BigInt over d.valueMinor and show via formatMoney next to the count.
  2. Consider responsive column width (min 220, snap scroll) and sticky headers.
- **Acceptance:**
  - Test: column with 2 deals of 1,00,000 and 50,000 paise shows total ₹1,500.00 formatted.
  - No float arithmetic.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Money display only; must use BigInt/paise.


---
## /crm/opportunities/new  —  `crm/opportunities-new.html`

- **Source:** `apps/web/src/app/(app)/crm/opportunities/new/page.tsx`
- **Design reference:** `redesign/crm/opportunities-new.html`

### GAP-CRM-OPPORTUNITIES-NEW-01  ·  HIGH  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** After a successful create the form stays filled and the page does not navigate or capture the new id, so a second click on Create opportunity POSTs a duplicate deal; onSaved is not passed by this route (apps/web/src/app/_components/crm/OpportunityForm.tsx:130, apps/web/src/app/(app)/crm/opportunities/new/page.tsx:15).
- **Verified evidence:** submit() (apps/web/src/app/_components/crm/OpportunityForm.tsx:95-136) on success sets message and calls onSaved?.() but the route passes no onSaved (new/page.tsx:14), fields are not reset and no id is captured (createOpportunity returns void, lib/crm/opportunity.ts:293-296). Button is disabled only while busy (268), so a second click POSTs another deal. No idempotency key.
- **Files to change:** `apps/web/src/app/_components/crm/OpportunityForm.tsx`, `apps/web/src/lib/crm/opportunity.ts`, `apps/web/src/app/(app)/crm/opportunities/new/page.tsx`
- **Fix steps:**
  1. Make createOpportunity return the created id (parse response) and pass onSaved from a client wrapper that router.push('/crm/opportunities') on success.
  2. Alternatively keep a 'saved' state that disables Create and shows 'Create another' which resets fields.
  3. Send an Idempotency-Key header (uuid per form session) if backend supports it.
  4. Run zod schema parse in submit for the payload.
- **Acceptance:**
  - Test: two rapid clicks produce one POST; after success navigation happens or button disabled.
  - Manual: list shows one new deal.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Duplicate deals distort pipeline value/forecast.

### GAP-CRM-OPPORTUNITIES-NEW-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The create form has no Account or Contact field: accountId is added to the payload only when editing an existing record, so every opportunity made here is unlinked to an account and cannot feed account-level views (OpportunityForm.tsx:124).
- **Verified evidence:** Payload adds accountId only from an existing record (apps/web/src/app/_components/crm/OpportunityForm.tsx:118); no account/contact input exists in the form; Opportunity type has accountId (apps/web/src/lib/crm/opportunity.ts:206). Whether backend requires/accepts contact: cannot-verify. No EntityPicker exists in repo.
- **Files to change:** `apps/web/src/app/_components/crm/OpportunityForm.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx`
- **Fix steps:**
  1. Create ds/EntityPicker (async search of accounts via existing accounts list endpoint).
  2. Add Account (and optional Contact) field to OpportunityForm state and payload accountId.
  3. Allow prefill via ?accountId= query on /crm/opportunities/new.
  4. Require account per business rule (decision).
- **Acceptance:**
  - Test: select account -> POST body includes accountId.
  - Account view lists the new deal.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Data model: unlinked deals already exist; making required could block quick capture.

### GAP-CRM-OPPORTUNITIES-NEW-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Mandatory stage fields are discovered only after a failed submit: the stage select shows a bare count "(needs 4)" but not which fields, so users fill the form, submit and are rejected (OpportunityForm.tsx:200,173).
- **Verified evidence:** Stage option shows ' (needs N)' (apps/web/src/app/_components/crm/OpportunityForm.tsx:194) but not field names; after a rejected submit the missing list is shown (162-166) and starred labels (isMissing). Line refs 200/173 in the finding were wrong. Stage mandatoryFields are already on selectedPipeline.stages (s.mandatoryFields) so names are available client-side.
- **Files to change:** `apps/web/src/app/_components/crm/OpportunityForm.tsx`
- **Fix steps:**
  1. When the chosen stage has mandatoryFields, render an inline hint 'This stage needs: …' using OPP_FIELD_LABELS.
  2. Compute required set from selectedPipeline stage and star labels proactively (replace isMissing with required||missing).
  3. Block submit locally and focus the first missing field.
- **Acceptance:**
  - Test: select stage with [value,product] -> hint lists Value, Product and both labels starred before submit.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; server remains the authority.

### GAP-CRM-OPPORTUNITIES-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 closed by #1859, verified on main 9c5e9e9e9; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** loading.tsx heading is "New" and the error boundary area is "CRM New", while the page title is "New Opportunity"; the error page reads "We couldn't open CRM New" (apps/web/src/app/(app)/crm/opportunities/new/loading.tsx:6, error.tsx:11).
- **Verified evidence:** loading.tsx h1 'New' with 4-tile skeleton (page is a single form card); error.tsx area 'CRM New' so RouteError prints "We couldn't open CRM New" (RouteError.tsx:63); page title 'New Opportunity'.
- **Files to change:** `apps/web/src/app/(app)/crm/opportunities/new/loading.tsx`, `apps/web/src/app/(app)/crm/opportunities/new/error.tsx`
- **Fix steps:**
  1. Set loading h1 to 'New Opportunity' and skeleton to a form-card shape.
  2. Set error area to 'the new opportunity form'.
- **Acceptance:**
  - Error page reads "We couldn't open the new opportunity form".
  - Loading heading equals page title.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-OPPORTUNITIES-NEW-05  ·  LOW  ·  confirmed  ·  theme A11Y (was FAILMASK)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The Name input is aria-invalid on first render (empty name), so assistive tech announces an error before the user has typed anything (OpportunityForm.tsx:191).
- **Verified evidence:** Name input has aria-invalid={name.trim() ? undefined : true} (apps/web/src/app/_components/crm/OpportunityForm.tsx:171) so it is invalid on first render; other fields flag only after invalid input. Theme is a11y/validation, not failure-mask.
- **Files to change:** `apps/web/src/app/_components/crm/OpportunityForm.tsx`
- **Fix steps:**
  1. Track touched/submitAttempted state; set aria-invalid on name only after blur or failed submit.
  2. Add aria-required and associate the error text via aria-describedby.
- **Acceptance:**
  - Test: initial render has no aria-invalid; after blur empty -> true.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-OPPORTUNITIES-NEW-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Probability and quantity default to 0 when left blank rather than unset, so an untouched form saves a 0% deal (OpportunityForm.tsx:121-122).
- **Verified evidence:** Payload uses probability: probability.trim()===''?0:probNum and quantity same (apps/web/src/app/_components/crm/OpportunityForm.tsx:112,114; finding cited 121-122). An untouched form saves 0% / 0 quantity, indistinguishable from a real 0.
- **Files to change:** `apps/web/src/app/_components/crm/OpportunityForm.tsx`, `apps/web/src/lib/crm/opportunity.ts`
- **Fix steps:**
  1. Make probability and quantity optional in Opportunity type / payload; omit keys when blank.
  2. Or default probability from the chosen stage's probability if pipeline provides it.
  3. Confirm backend accepts absent values (else keep and document).
- **Acceptance:**
  - Test: blank fields -> POST body has no probability/quantity (or stage default).
  - Detail view shows '—' not 0%.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Forecast weighting uses probability; 0 zeroes weighted value.


---
## /crm/opportunity-ageing  —  `crm/opportunity-ageing.html`

- **Source:** `apps/web/src/app/(app)/crm/opportunity-ageing/page.tsx`
- **Design reference:** `redesign/crm/opportunity-ageing.html`

### GAP-CRM-OPPORTUNITY-AGEING-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Stage limits are keyed by a hand-typed "stage key" with no pipeline selector or stage list; a typo (e.g. "proposel") saves as a valid limit that matches nothing, silently disabling the alert for that stage (apps/web/src/app/_components/crm/StageAgeingDashboard.tsx:205,87).
- **Verified evidence:** apps/web/src/app/_components/crm/StageAgeingDashboard.tsx:219-226 Stage is a free <input placeholder='stage key'>; rowValid (:75-77) only checks non-empty; saveLimit (:86-92) PUTs it as-is via createStageLimit (lib/crm/opportunity.ts:585, upsert keyed pipelineId+stage). New rows never get a pipelineId (:72). Whether the server rejects unknown stage keys cannot be verified (crm-service absent). Ageing rows carry stage and stageName (opportunity.ts:477-486), so the key must equal the server's stage key.
- **Files to change:** `apps/web/src/app/_components/crm/StageAgeingDashboard.tsx`, `apps/web/src/lib/crm/opportunity.ts`
- **Fix steps:**
  1. Load pipelines with getPipelines() in StageAgeingDashboard and add a pipeline <select> per limit row (set pipelineId).
  2. Replace the stage text input with a <select> of that pipeline's stages (value=stage.key, label=stage.name); keep an unknown legacy key as a disabled 'not in pipeline' option flagged aria-invalid.
  3. Make rowValid require the stage to be in the selected pipeline's stage list.
  4. Show an 'orphan' warning on existing limits whose stage matches no pipeline stage.
- **Acceptance:**
  - Unit: typing/selecting a stage not in the pipeline blocks Save with an inline message.
  - Manual: a limit row offers only the chosen pipeline's stages by name; saving 'Proposal' then shows breaches for that stage.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; config UI only. Existing limits with legacy keys must still be visible/removable.
- **Depends on:** GAP-CRM-PIPELINES-06

### GAP-CRM-OPPORTUNITY-AGEING-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The `enabled` flag of a limit is sent (true) but never shown or editable, so a limit can only be removed, not paused (StageAgeingDashboard.tsx:87).
- **Verified evidence:** apps/web/src/app/_components/crm/StageAgeingDashboard.tsx:86-92 payload sets enabled: row.enabled ?? true; the table (:199-257) has only Stage, Limit (days), Actions columns, no toggle. StageLimit.enabled exists (opportunity.ts:538) and is normalised (:552). Saving a limit that was disabled server-side re-enables it silently.
- **Files to change:** `apps/web/src/app/_components/crm/StageAgeingDashboard.tsx`
- **Fix steps:**
  1. Add an 'Enabled' checkbox column bound to update(row.key,{enabled}) with aria-label per row.
  2. Show 'Paused' text beside disabled rows and exclude them from the confirm copy.
  3. Keep payload.enabled from the row (already wired).
- **Acceptance:**
  - Component test: unticking Enabled and Save sends enabled:false in the PUT body.
  - Manual: a limit disabled on the server appears unticked and stays disabled after an unrelated days edit.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Today Save re-enables paused limits; fix removes that side effect.

### GAP-CRM-OPPORTUNITY-AGEING-03  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Ageing breaches show the opportunity name as plain text with no link to the record and no owner column, so a manager cannot see who to chase (StageAgeingDashboard.tsx:163).
- **Verified evidence:** apps/web/src/app/_components/crm/StageAgeingDashboard.tsx:161-163 renders <td>{r.name}</td> plain text; StageAgeingRow (opportunity.ts:477-486) has no owner/id link field and normaliseAgeing (:488-514) drops any owner in the payload. Opportunity detail route exists at /crm/opportunities (list) and deals detail at /crm/deals/[id] (used by DealCard). Whether the ageing endpoint returns an owner cannot be verified (crm-service absent).
- **Files to change:** `apps/web/src/app/_components/crm/StageAgeingDashboard.tsx`, `apps/web/src/lib/crm/opportunity.ts`
- **Fix steps:**
  1. Wrap r.name in <Link href={`/crm/deals/${r.id}`}> (confirm the correct opportunity detail route first; DealCard uses /crm/deals/:id).
  2. If the endpoint returns ownerName/ownerId, add it to StageAgeingRow + normaliseAgeing and an Owner column; otherwise raise a backend ask.
  3. Use the shared table/link styles; keep row keyed by r.id.
- **Acceptance:**
  - Manual: clicking a breach name opens the record.
  - Unit: normaliseAgeing maps ownerName when present.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low. Owner column depends on backend field.

### GAP-CRM-OPPORTUNITY-AGEING-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The ageing error says "Showing saved information" while the badge says "Couldn't load — showing nothing"; nothing is cached, so the two messages contradict (StageAgeingDashboard.tsx:135, DataSourceBadge.tsx:47).
- **Verified evidence:** apps/web/src/app/_components/crm/StageAgeingDashboard.tsx:135 shows <DataSourceBadge source='error'/> (DataSourceBadge.tsx:47-48 -> 'Couldn't load — showing nothing') while :142 EmptyState says 'Ageing could not be loaded. Showing saved information.' Nothing is cached (getStageAgeing returns data:[] on error, opportunity.ts:517-526). Same false 'saved information' line in PriceBookEditor.tsx:337.
- **Files to change:** `apps/web/src/app/_components/crm/StageAgeingDashboard.tsx`, `apps/web/src/app/_components/crm/PriceBookEditor.tsx`
- **Fix steps:**
  1. Replace the error EmptyState in StageAgeingDashboard with <RefreshErrorState> (ds) or a retry button calling loadAgeing().
  2. Drop the 'Showing saved information' sentence; remove the duplicate badge or keep one message.
  3. Apply the same copy fix to PriceBookEditor resolve error line (:337).
- **Acceptance:**
  - Manual: force 500 on stage-ageing -> one message, with Retry, no mention of saved data.
  - Grep: no 'Showing saved information' remains in apps/web/src/app/_components/crm.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-CRM-OPPORTUNITY-AGEING-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Any CRM user can change or delete limits that drive the alert for the whole tenant; unlike task-escalation and qualification-frameworks this route has no admin-only layout (crm/layout.tsx:5, no opportunity-ageing/layout.tsx).
- **Verified evidence:** apps/web/src/app/(app)/crm/layout.tsx:5-8 allows crm_user for all CRM routes; opportunity-ageing has only error/loading/page (no layout.tsx) whereas task-escalation/layout.tsx and qualification-frameworks/layout.tsx use requireAnyRole(['crm_admin','admin','super_admin','platform_admin','tenant_admin'],'/crm'). The page's limits card has Save/Delete for anyone. Server-side authorisation cannot be verified (crm-service absent).
- **Files to change:** `apps/web/src/app/(app)/crm/opportunity-ageing/layout.tsx`, `apps/web/src/app/(app)/crm/pipelines/layout.tsx`, `apps/web/src/app/(app)/crm/price-books/layout.tsx`, `apps/web/src/app/(app)/crm/products/layout.tsx`
- **Fix steps:**
  1. DECISION first: ageing view is useful to managers, config is admin. Preferred: keep the page for crm_user but hide/disable the limits card unless the user has an admin role.
  2. If whole-route gating chosen, copy task-escalation/layout.tsx (requireAnyRole with the admin list, redirect /crm).
  3. Extract ADMIN_ROLES to a shared constant (e.g. lib/crm/roles.ts) and reuse across these four routes.
  4. Confirm crm-service enforces the same role on PUT/DELETE /v1/crm/stage-limits.
- **Acceptance:**
  - Manual: a crm_user session cannot see Save/Delete (or is redirected); crm_admin can.
  - Server returns 403 for stage-limits writes by crm_user.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Medium: locking the route out of managers who rely on the ageing list; hence the split-page option.
- **Depends on:** GAP-CRM-PIPELINES-03, GAP-CRM-PRODUCTS-01

### GAP-CRM-OPPORTUNITY-AGEING-06  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 closed by #1860, verified on main 9c5e9e9e9; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** loading.tsx heading is "Opportunity Ageing" but the page title is "Stage Ageing" (opportunity-ageing/loading.tsx:6).
- **Verified evidence:** opportunity-ageing/loading.tsx:6 has <h1>Opportunity Ageing</h1>; page.tsx:8 PageHeader title is 'Stage Ageing'. Loading skeleton also shows 4 stat tiles and one block whereas the page renders two cards (no stat tiles).
- **Files to change:** `apps/web/src/app/(app)/crm/opportunity-ageing/loading.tsx`
- **Fix steps:**
  1. Change the heading to 'Stage Ageing'.
  2. Replace the 4 stat skeletons with two card-shaped skeletons matching the breaches and limits cards.
- **Acceptance:**
  - Visual: navigating to the route shows the same title before and after load.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /crm/pipeline  —  `crm/pipeline.html`

- **Source:** `apps/web/src/app/(app)/crm/pipeline/page.tsx`
- **Design reference:** `redesign/crm/pipeline.html`

### GAP-CRM-PIPELINE-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed load the four StatCards print 0, ₹0.00 and 0% (no "—" fallback, unlike rti and service-requests) and the board shows "No deals in pipeline / Create Deal", so an outage reads as an empty pipeline; only a small badge above says otherwise (apps/web/src/app/(app)/crm/pipeline/page.tsx:36-40, _components/KanbanBoard.tsx:162).
- **Verified evidence:** pipeline/page.tsx:8-20 on error loaders return [] so totals compute to 0, and :33-36 StatCards render '0', formatMoney(0n) and '0%' with no '—' fallback; badge only at :30. KanbanBoard.tsx:207-217 renders 'No deals in pipeline / Create Deal' whenever localDeals is empty, regardless of the source prop (source is used only by useSeededResource :43-48, which may substitute a cached copy).
- **Files to change:** `apps/web/src/app/(app)/crm/pipeline/page.tsx`, `apps/web/src/app/(app)/crm/pipeline/_components/KanbanBoard.tsx`
- **Fix steps:**
  1. In page.tsx, when source==='error' render <RefreshErrorState> (ds/RefreshErrorState.tsx) in place of StatGrid and board (or pass '—' values).
  2. Set StatCard values to '—' when errored.
  3. In KanbanBoard, guard the empty state with source!=='error' && !fromCache; otherwise show the error state.
  4. Keep the cached-data path (useSeededResource) working: only show error when nothing cached.
- **Acceptance:**
  - Manual: block /api/v1/crm/deals -> error state with Retry, no zeros, no 'Create Deal'.
  - Unit: KanbanBoard with source='error', deals=[] does not render 'No deals in pipeline'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-CRM-PIPELINE-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Dropping a card saves at once, optimistically, with no confirmation, and overwrites the deal's own probability with the stage default; /crm/opportunities asks to confirm and enforces mandatory stage fields, this board does neither (KanbanBoard.tsx:80-100).
- **Verified evidence:** apps/web/src/app/(app)/crm/pipeline/_components/KanbanBoard.tsx:91-130 moveDealToStage applies an optimistic update on drop/keyboard arrow and PATCHes /deals/:id/stage immediately with probability: targetStage.probability (:109,127); no ConfirmDialog, no mandatory-field check. OpportunityViews.tsx:355-366 uses a ConfirmDialog and OP-003 mandatory-field validation for the same move. Server-side stage-entry enforcement cannot be verified (crm-service absent).
- **Files to change:** `apps/web/src/app/(app)/crm/pipeline/_components/KanbanBoard.tsx`, `apps/web/src/app/_components/crm/OpportunityViews.tsx`
- **Fix steps:**
  1. Extract the confirm+mandatory-field logic from OpportunityViews (confirmMove ~:111, ConfirmDialog :355) into a shared hook e.g. useStageMove.
  2. In moveDealToStage, replace the immediate PATCH with a pending-move state that opens ConfirmDialog (gate stages and Won/Lost require it); apply the optimistic update only on confirm.
  3. Do not send probability unless the deal's own probability is unset/user accepts the stage default; show the change in the dialog.
  4. Surface server 4xx for missing mandatory fields via formError.fromResponse and revert (already reverts).
- **Acceptance:**
  - Component test: dropping a card opens the dialog and issues no PATCH until confirmed; cancel leaves the card in place.
  - Test: a deal with probability 45 moved to a 30% stage keeps 45 unless the user accepts the default.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: changes core sales workflow; audit event emission on stage change is a backend concern (cannot verify).
- **Depends on:** GAP-CRM-PIPELINE-01

### GAP-CRM-PIPELINE-03  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** "High-Value Engagements" counts valueMinor >= 1000000 paise (₹10,000), an unlabelled hard-coded threshold that is trivial for departmental contracts (lakhs to crores), so the tile equals the total (pipeline/page.tsx:22).
- **Verified evidence:** pipeline/page.tsx:22 filters valueMinor >= 1000000n paise (= INR 10,000), unlabelled magic number, tile label 'High-Value Engagements' (:38). Threshold is real; the claim that the tile 'equals the total' is an inference that holds only when all deals exceed INR 10,000, and is not something the code guarantees.
- **Files to change:** `apps/web/src/app/(app)/crm/pipeline/page.tsx`
- **Fix steps:**
  1. Move the threshold to a named constant (paise, bigint) e.g. HIGH_VALUE_MINOR in lib/crm.
  2. DECISION: choose the business value (e.g. INR 1 crore = 10000000_00n) or make it tenant-configurable.
  3. Show it in the label/hint: 'High-Value (>= formatMoney(threshold))'.
- **Acceptance:**
  - Unit: deals at threshold-1 and threshold count 0 and 1.
  - Manual: label states the threshold.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; tile meaning changes.

### GAP-CRM-PIPELINE-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Vocabulary splits within the screen: header and cards say "Engagement", the empty state and columns say "deals" ("No deals in pipeline", "Create Deal", "Drop deals here"), and the sister page calls the same records "Opportunities" (KanbanBoard.tsx:164, StageColumn.tsx:80).
- **Verified evidence:** Header 'Engagement Pipeline' and cards say Engagement (page.tsx:26-38, DealCard aria-label); KanbanBoard.tsx:212-214 'No deals in pipeline','Create Deal'; StageColumn.tsx:74 'deals' and :98 'Drop deals here'; sister page is /crm/opportunities. (Observation cites KanbanBoard.tsx:164, actual :212.)
- **Files to change:** `apps/web/src/app/(app)/crm/pipeline/_components/KanbanBoard.tsx`, `apps/web/src/app/(app)/crm/pipeline/_components/StageColumn.tsx`, `apps/web/src/app/(app)/crm/pipeline/page.tsx`
- **Fix steps:**
  1. DECISION: pick one term (Opportunity matches the sister page and nav).
  2. Replace strings in page.tsx, KanbanBoard, StageColumn, DealCard and announcer messages.
  3. Put the term in a shared constants/i18n file.
- **Acceptance:**
  - Grep pipeline dir for 'deal'/'Engagement' finds only the chosen term in user-visible text.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-PIPELINE-05  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Only pipelines[0] is rendered with no selector, and deals are fetched with limit=200 with no truncation notice, so a second pipeline or the 201st deal is invisible (pipeline/page.tsx:15, loaders.ts:2901).
- **Verified evidence:** pipeline/page.tsx:11 uses pipelines[0] with no selector; loaders.ts:2901 fetches /api/v1/crm/deals?limit=200 with no total or truncation notice; stat cards (:17-21) are computed from those 200. Deals of a second pipeline would also be matched by stage name in the first pipeline's columns (KanbanBoard.tsx:259-261).
- **Files to change:** `apps/web/src/app/(app)/crm/pipeline/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/crm/pipeline/_components/KanbanBoard.tsx`
- **Fix steps:**
  1. Add ?pipelineId searchParam and a pipeline <select>; pass pipelineId to getPipelineDeals (only if the deals endpoint supports it: cannot verify).
  2. Read pagination/total from the response in mapPipelineDeals and show 'Showing 200 of N' banner when truncated.
  3. Compute the stat cards from a server aggregate rather than the capped list if one exists.
- **Acceptance:**
  - Manual: with 250 deals a truncation notice shows; switching pipeline reloads its board.
  - Unit: mapPipelineDeals surfaces total.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: stats misreport for large tenants today.

### GAP-CRM-PIPELINE-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The deal-name link inside each card has tabIndex -1, so keyboard users can move a card but cannot open its record (DealCard.tsx:56).
- **Verified evidence:** DealCard.tsx:52-58 the <a href='/crm/deals/:id'> has tabIndex={-1}; the card is role=button tabIndex=0 whose keydown handler handles arrows/Enter only for moving. No keyboard path to the record.
- **Files to change:** `apps/web/src/app/(app)/crm/pipeline/_components/DealCard.tsx`
- **Fix steps:**
  1. Remove tabIndex={-1} from the link, or add an 'Open' key (e.g. o) plus a visible 'Open' link.
  2. Update the aria-label hint to mention how to open the record.
  3. Avoid nesting interactive link inside role=button: make the card a div with a separate move handle.
- **Acceptance:**
  - Keyboard: Tab reaches the deal link and Enter navigates.
  - axe: no nested-interactive violation.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /crm/pipelines  —  `crm/pipelines.html`

- **Source:** `apps/web/src/app/(app)/crm/pipelines/page.tsx`
- **Design reference:** `redesign/crm/pipelines.html`

### GAP-CRM-PIPELINES-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Stages cannot be reordered: order is the process flow, but the editor only appends new stages and removes existing ones (PipelineEditor.tsx:145-170).
- **Verified evidence:** apps/web/src/app/_components/crm/PipelineEditor.tsx:93-98 only addStage (append) and removeStage exist; the stage row (:247-280) has no up/down control. Stage order is array order and saved as-is (:112-120).
- **Files to change:** `apps/web/src/app/_components/crm/PipelineEditor.tsx`
- **Fix steps:**
  1. Add moveStage(idx, dir) swapping adjacent stages in draft.stages.
  2. Render up/down Buttons with aria-labels ('Move stage N up') in the stage row header, disabled at ends.
  3. Announce the move via an aria-live message.
- **Acceptance:**
  - Component test: moving stage 2 up swaps order and Save payload reflects it.
  - Keyboard operable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Medium: reordering stages on a pipeline with live deals changes flow; server must key on stage key not index (cannot verify).

### GAP-CRM-PIPELINES-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Pipeline configuration is open to every CRM user; qualification-frameworks and task-escalation use an admin-only layout but this route relies on the broad CRM layout (crm/layout.tsx:5).
- **Verified evidence:** crm/layout.tsx:5-8 only requires CRM_ROLES incl. crm_user; pipelines/ has error/loading/page and no layout.tsx, unlike task-escalation and qualification-frameworks (requireAnyRole admin list). PipelineEditor exposes create, edit, delete. Server enforcement cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/crm/pipelines/layout.tsx`
- **Fix steps:**
  1. Add layout.tsx copying task-escalation/layout.tsx with the admin role list.
  2. Share the role list constant with the other CRM config routes.
  3. Confirm crm-service restricts pipeline writes.
- **Acceptance:**
  - crm_user is redirected to /crm; crm_admin loads the page.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Medium: /crm/pipeline board reads pipelines and must not be affected.
- **Depends on:** GAP-CRM-OPPORTUNITY-AGEING-05

### GAP-CRM-PIPELINES-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** "Gate" is a bare checkbox with no explanation; the meaning ("requires an explicit review before the deal may pass") lives only in a type comment, and scope inputs (Product/Region/Business unit) are free text with no picker (PipelineEditor.tsx:255, lib/crm/opportunity.ts:101).
- **Verified evidence:** apps/web/src/app/_components/crm/PipelineEditor.tsx:261-269 bare 'Gate' checkbox, no help text; :299-321 product/region/business unit are free-text inputs. Meaning of gate is only in lib/crm/opportunity.ts:101 comment. No lookup source visible for scope values (cannot verify a catalogue API).
- **Files to change:** `apps/web/src/app/_components/crm/PipelineEditor.tsx`
- **Fix steps:**
  1. Add helper text/HelpTip: 'Requires an explicit review before a deal can enter or pass this stage'.
  2. Replace Product scope with a select over getProducts() (lib/crm/quotation) if scope holds product ids/codes (confirm semantics).
  3. Keep region/business unit free text until master data exists; add datalist of existing values.
- **Acceptance:**
  - Manual: Gate has visible explanation.
  - Product scope offers catalogue items.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; scope value format must match server matching.

### GAP-CRM-PIPELINES-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Clicking Edit on another pipeline silently replaces an unsaved draft with no dirty warning, and the editor opens below the list without scrolling into view (PipelineEditor.tsx:74).
- **Verified evidence:** apps/web/src/app/_components/crm/PipelineEditor.tsx:67-72 edit() replaces draft unconditionally; startNew (:62) likewise; the fieldset renders below the list (:219-225) with no ref/scrollIntoView or focus move.
- **Files to change:** `apps/web/src/app/_components/crm/PipelineEditor.tsx`
- **Fix steps:**
  1. Track dirty state (JSON compare with original draft).
  2. If dirty when Edit/New is clicked, open ConfirmDialog 'Discard unsaved changes?'.
  3. After setDraft, scrollIntoView and focus the name input via ref in useEffect.
- **Acceptance:**
  - Test: edit A, change name, click Edit B -> confirm shown.
  - Manual: opening an editor scrolls it into view.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-PIPELINES-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Stage-name edits keep the old stage key, so keys drift from names (e.g. name "Proposal", key "stage_2") and stage limits typed against keys become opaque (PipelineEditor.tsx:120).
- **Verified evidence:** apps/web/src/app/_components/crm/PipelineEditor.tsx:29-31 blankStage assigns key `stage_${SEQ++}` at creation; save (:118) only derives from the name when key is empty, which never happens, so renaming never changes the key and new keys are stage_0, stage_1... Stage limits are entered against this key (StageAgeingDashboard placeholder 'stage key').
- **Files to change:** `apps/web/src/app/_components/crm/PipelineEditor.tsx`, `apps/web/src/app/_components/crm/StageAgeingDashboard.tsx`
- **Fix steps:**
  1. Generate keys on first save from slugified name (uniqueness-suffixed) instead of stage_N; leave existing persisted keys immutable.
  2. Show the key read-only next to each saved stage.
  3. Pair with the stage-limit dropdown so users never type keys.
- **Acceptance:**
  - Unit: new stage named 'Proposal' saves key 'proposal'.
  - Renaming a saved stage leaves its key unchanged.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Medium: changing key semantics on saved pipelines would orphan limits; only alter new stages.
- **Depends on:** GAP-CRM-OPPORTUNITY-AGEING-01


---
## /crm/price-books  —  `crm/price-books.html`

- **Source:** `apps/web/src/app/(app)/crm/price-books/page.tsx`
- **Design reference:** `redesign/crm/price-books.html`

### GAP-CRM-PRICE-BOOKS-01  ·  HIGH  ·  partly  ·  theme AUDIT (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Price books that drive quotation prices are edited in place with no effective dates, version, or change history shown: saving a new rate overwrites the one in force for every quotation built afterwards, and nothing on the page shows who changed a price or when (apps/web/src/app/_components/crm/PriceBookEditor.tsx:104-135, lib/crm/quotation.ts:203-224).
- **Verified evidence:** PriceBook (lib/crm/quotation.ts:151-160) has no effective-from/to or version, and apps/web/src/app/_components/crm/PriceBookEditor.tsx:126-131 sends a PATCH overwrite (quotation.ts:213-217); the page shows no changed-by/at. True for the UI. Whether crm-service versions or audits price books cannot be verified (absent). The DATEFMT theme is wrong.
- **Files to change:** `apps/web/src/app/_components/crm/PriceBookEditor.tsx`, `apps/web/src/lib/crm/quotation.ts`
- **Fix steps:**
  1. DECISION with backend: add effectiveFrom/effectiveTo, version, updatedBy/updatedAt to PriceBook.
  2. Show version and 'Last changed by X on dd Mon yyyy (IST)' per book using the shared date formatter.
  3. Add a history drawer if the API exposes audit events.
  4. Require a confirm/reason when editing an enabled book.
- **Acceptance:**
  - Manual: editing a price shows a new version and author/time.
  - Existing quotations keep their captured price.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** High: pricing integrity for quotations; needs audit event.

### GAP-CRM-PRICE-BOOKS-02  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Segment, Geography and Channel are free-text fields (placeholders "government", "north", "direct"), and the resolver matches on the same typed text, so a typo yields a book that can never resolve; geography examples do not match state/district geography (PriceBookEditor.tsx:262-285).
- **Verified evidence:** apps/web/src/app/_components/crm/PriceBookEditor.tsx:236,244,248 Segment/Geography/Channel are free-text inputs with placeholders 'government','north','direct'; resolvePriceBook passes the trimmed text (:158-168). Typo risk is real; 'fabricated' theme is wrong (placeholders, not data). Geography 'north' vs state/district taxonomy cannot be verified without master data.
- **Files to change:** `apps/web/src/app/_components/crm/PriceBookEditor.tsx`
- **Fix steps:**
  1. Replace with selects backed by an enum/master list (DECISION: source of segments/channels/geography).
  2. Until then offer a <datalist> of values already used in existing books and warn on unknown values.
  3. Show 'no book will match' hint on resolve miss.
- **Acceptance:**
  - Manual: choosing values from a list; free typo cannot be saved.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-PRICE-BOOKS-04  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1861, verified on main 9c5e9e9e9)
- **First-pass claim:** Currency is a free-text field, yet prices are always entered as rupees and echoed with the ₹ formatter, so a USD book would silently show rupee amounts (PriceBookEditor.tsx:268, lib/formatters.ts:127).
- **Verified evidence:** apps/web/src/app/_components/crm/PriceBookEditor.tsx:240 Currency is free text (default INR); prices are entered in rupees (rupeesToMinorString :113) and formatted via formatMoney (:343) which always emits the INR symbol (formatters.ts:90-134). A book with currency 'USD' would display rupees.
- **Files to change:** `apps/web/src/app/_components/crm/PriceBookEditor.tsx`
- **Fix steps:**
  1. Make currency a <select> limited to supported codes (INR only for now) and disable it, or extend formatMoney with a currency arg.
  2. If multi-currency is required, label price inputs with the book currency and format with it.
  3. Validate against the enum in draftValid.
- **Acceptance:**
  - Unit: a USD book renders $ (or is impossible to create).
  - Manual: currency cannot be free typed.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Medium: money display.
- **Depends on:** GAP-CRM-PRODUCTS-06

### GAP-CRM-PRICE-BOOKS-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The product picker lists every product, including disabled or out-of-window ones, while the quotation builder disables those; a book can be priced for a product that cannot be quoted, and the same product can be added twice (PriceBookEditor.tsx:296, QuotationBuilder.tsx:388).
- **Verified evidence:** apps/web/src/app/_components/crm/PriceBookEditor.tsx:268-272 maps every product with no filter; QuotationBuilder.tsx:420-421 disables products failing isProductSelectable. Entries (:290) can be added repeatedly; select has no duplicate exclusion.
- **Files to change:** `apps/web/src/app/_components/crm/PriceBookEditor.tsx`
- **Fix steps:**
  1. Filter/annotate options with isProductSelectable(p) (disabled + ' — inactive').
  2. Exclude products already used in other entries of the draft; block save on duplicate productId in save()/draftValid.
- **Acceptance:**
  - Unit: duplicate productId blocks save.
  - Inactive products show disabled in the picker.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; existing books with inactive products must still display (keep the current selection visible).

### GAP-CRM-PRICE-BOOKS-06  ·  LOW  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Create/Save book is disabled without saying why (no inline validation text), unlike other editors that print a message (PriceBookEditor.tsx:317).
- **Verified evidence:** apps/web/src/app/_components/crm/PriceBookEditor.tsx:297 Save disabled by !draftValid(draft) (:101-103) with no message; other editors (PipelineEditor) show setError on click. Note draftValid treats blank price as '0.01' valid but save() (:113) then rejects blank, so the button enables and errors later.
- **Files to change:** `apps/web/src/app/_components/crm/PriceBookEditor.tsx`
- **Fix steps:**
  1. Show inline reason text beside the disabled button (name required, price invalid), aria-describedby on the button.
  2. Align draftValid with save() (blank price invalid).
- **Acceptance:**
  - Test: empty name shows 'A price book needs a name.' and button disabled.
  - Blank price row is flagged aria-invalid.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /crm/products  —  `crm/products.html`

- **Source:** `apps/web/src/app/(app)/crm/products/page.tsx`
- **Design reference:** `redesign/crm/products.html`

### GAP-CRM-PRODUCTS-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Any CRM user can change a product price or tax rate, which flows straight into quotations; the catalogue shows no last-changed-by/at, and Delete removes a product with no indication of how many quotations or price books reference it (apps/web/src/app/_components/crm/ProductCatalogueEditor.tsx:99-125,262).
- **Verified evidence:** products/ has no layout.tsx (only crm/layout.tsx crm_user); apps/web/src/app/_components/crm/ProductCatalogueEditor.tsx:94-118 saves price/tax to the catalogue and :120-138 deletes; the table (:172-187) has no updated-by/at column and the delete dialog (:263-272) shows a generic description. Server audit/references cannot be verified (absent).
- **Files to change:** `apps/web/src/app/_components/crm/ProductCatalogueEditor.tsx`, `apps/web/src/app/(app)/crm/products/layout.tsx`
- **Fix steps:**
  1. Add admin layout.tsx (as task-escalation).
  2. Show updatedBy/updatedAt columns if the API returns them (backend ask otherwise).
  3. Ask the backend for a usage count (quotations/price books) and show it in the delete dialog; disable delete when referenced.
  4. Consider soft-disable instead of delete.
- **Acceptance:**
  - crm_user cannot edit prices.
  - Deleting a referenced product warns or is blocked.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: pricing/tax flows to quotations; needs audit event.
- **Depends on:** GAP-CRM-OPPORTUNITY-AGEING-05

### GAP-CRM-PRODUCTS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Tax is a single free-text percentage per product: no HSN/SAC code, no GST slab list, and no CGST/SGST/IGST split, so a mistyped rate (e.g. 81) saves as valid and invoices cannot be tied to a tax classification (ProductCatalogueEditor.tsx:66,215).
- **Verified evidence:** apps/web/src/app/_components/crm/ProductCatalogueEditor.tsx:77-80 taxBpsOf uses percentToBps (money.ts:68-77), which accepts any non-negative number up to 2 decimals, so 81 (8100 bps) is valid; Product has only taxRateBps (quotation.ts:70), no HSN/SAC or CGST/SGST/IGST fields.
- **Files to change:** `apps/web/src/app/_components/crm/ProductCatalogueEditor.tsx`, `apps/web/src/lib/crm/quotation.ts`
- **Fix steps:**
  1. Replace the Tax % input with a select of GST slabs (0,5,12,18,28) plus custom-with-confirm; cap at 100 in taxBpsOf.
  2. DECISION/backend: add hsnSac to Product and payload; CGST/SGST/IGST split is determined at invoice time by place of supply.
  3. Validate HSN/SAC format (4/6/8 digits) with zod.
- **Acceptance:**
  - Unit: 81 rejected or warned; 18 accepted.
  - HSN saved when backend field exists.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: tax accuracy.

### GAP-CRM-PRODUCTS-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** A blank Price or blank Tax % silently saves as 0, so a half-filled row becomes a ₹0.00, 0% product that is "Live" and quotable (ProductCatalogueEditor.tsx:66-72).
- **Verified evidence:** apps/web/src/app/_components/crm/ProductCatalogueEditor.tsx:73-80 blank price returns '0' and blank tax returns 0; rowValid passes; blank() new row has priceMinor '0', enabled true (:39), so save posts a INR 0.00 live product.
- **Files to change:** `apps/web/src/app/_components/crm/ProductCatalogueEditor.tsx`
- **Fix steps:**
  1. Make blank price and blank tax invalid (return null) so rowValid fails with a specific message.
  2. Allow 0 only when explicitly typed (and confirm for price 0).
  3. Highlight the blank field aria-invalid.
- **Acceptance:**
  - Unit: blank price blocks Save with message.
  - Typed '0' saves after confirm.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-PRODUCTS-04  ·  MEDIUM  ·  partly  ·  theme RESPONSIVE (was PII)

- [x] **Status** (W2 2026-10-16: closed by #TBD, W2 crm: closed by #28cfc8098)
- **W0-10 note:** review found the W0 tick partly — stacked-card media query at <=640px added (ProductCatalogueEditor.tsx:276-282) but inputs keep minHeight:36 (:49), fix step 3 (>=44px touch height) not done
- **First-pass claim:** Ten editable columns render as a horizontally scrolling table (overflowX auto) with no card transform at phone width, and every cell is an input, so the row is hard to read or edit on mobile (ProductCatalogueEditor.tsx:168).
- **Verified evidence:** Table is 10 columns inside overflowX:auto (ProductCatalogueEditor.tsx:170-171), every cell an input; no responsive card transform. Real, but theme tag PII is wrong (responsive/mobile).
- **Files to change:** `apps/web/src/app/_components/crm/ProductCatalogueEditor.tsx`
- **Fix steps:**
  1. At <=640px render each product as a stacked card (label/field pairs) using a media query or CSS grid.
  2. Keep the desktop table.
  3. Ensure inputs >=44px touch height.
- **Acceptance:**
  - Manual at 375px: no horizontal scroll, all fields reachable.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-CRM-PRODUCTS-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The Live/Off badge is computed from unsaved edits, so toggling Enabled shows "Live" before anything is saved, and there is no dirty marker per row or check that Active to is not before Active from (ProductCatalogueEditor.tsx:196).
- **Verified evidence:** apps/web/src/app/_components/crm/ProductCatalogueEditor.tsx:194-196 selectable is computed from the in-memory row (row.enabled, activeFrom, activeTo) so toggling the checkbox flips the badge to Live before Save; no per-row dirty marker; save (:94-106) never checks activeTo >= activeFrom.
- **Files to change:** `apps/web/src/app/_components/crm/ProductCatalogueEditor.tsx`
- **Fix steps:**
  1. Keep a snapshot of the loaded row; compute dirty = differs from snapshot and show 'Unsaved' tag.
  2. Label badge 'Live after save' when dirty.
  3. Validate activeTo >= activeFrom in rowValid with message.
- **Acceptance:**
  - Unit: activeTo before activeFrom blocks Save.
  - Toggling Enabled shows Unsaved marker and not 'Live'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-PRODUCTS-06  ·  LOW  ·  partly  ·  theme MONEY

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Code is not checked for duplicates client-side and Currency is fixed to INR with no field, so multi-currency price books cannot reference a matching product currency (ProductCatalogueEditor.tsx:44,98).
- **Verified evidence:** apps/web/src/app/_components/crm/ProductCatalogueEditor.tsx:98-101 no client-side duplicate-code check (server enforcement cannot be verified); currency is not editable: blank() sets 'INR' (:39) but existing rows keep their loaded currency and payload sends row.currency.trim()||'INR' (:102), so 'fixed to INR with no field' is true only for new rows. Price display always uses formatMoney (INR).
- **Files to change:** `apps/web/src/app/_components/crm/ProductCatalogueEditor.tsx`
- **Fix steps:**
  1. Add duplicate-code check (case-insensitive) in rowValid across rows.
  2. DECISION: if multi-currency is needed, add a Currency select and use a currency-aware formatter; otherwise show read-only 'INR'.
- **Acceptance:**
  - Unit: two rows with the same code block Save.
  - Currency visible per row.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; money display.
- **Depends on:** GAP-CRM-PRICE-BOOKS-04


---
## /crm/qualification-frameworks  —  `crm/qualification-frameworks.html`

- **Source:** `apps/web/src/app/(app)/crm/qualification-frameworks/page.tsx`
- **Design reference:** `redesign/crm/qualification-frameworks.html`

### GAP-CRM-QUALIFICATION-FRAMEWORKS-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The page defines weighted questions "that decide whether a lead qualifies" but has no total, no normalisation and no pass threshold anywhere; weights are independent 0–100 numbers, so two admins can build frameworks summing to 60 and 240 with no cue (apps/web/src/app/_components/crm/QualificationFrameworksEditor.tsx:30,225-275).
- **Verified evidence:** QualificationFrameworksEditor.tsx:31-35 sanitizeNumber clamps each weight to int 0-100; the question table (225-257) has no Total row, no normalisation and no pass-threshold field; Save (112-131) sends only name/businessLine/active/questions. Score/outcome is computed server-side (QualifyPanel.tsx:60,143 shows result.outcome/score) and crm-service is absent from the snapshot, so how the backend uses weights/threshold is cannot-verify. UI-side claim is accurate.
- **Files to change:** `apps/web/src/app/_components/crm/QualificationFrameworksEditor.tsx`
- **Fix steps:**
  1. Add a derived 'Total weight' row under the questions table (sum of q.weight) with a hint 'Weights are relative; total N'.
  2. Show a per-question share (weight/total as %) so admins see relative impact.
  3. Ask backend/product whether frameworks have a passThreshold; if yes add a threshold input (int 0-100 or % of total) to QualificationFramework in lib/crm/leadQualification.ts and send it in createFramework/updateFramework.
  4. Warn (non-blocking) when total is 0 or when no threshold is set.
- **Acceptance:**
  - Component test: framework with weights 20,30 renders 'Total 50' and shares 40%/60%.
  - Changing a weight updates the total live; total 0 shows warning.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low for the total display; adding a threshold changes scoring semantics and needs backend contract (decision).

### GAP-CRM-QUALIFICATION-FRAMEWORKS-03  ·  MEDIUM  ·  partly  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Save validates only name and business line: empty question text and a NaN weight pass and are sent (QualificationFrameworksEditor.tsx:110).
- **Verified evidence:** save() (QFE:112-131) checks only name and businessLine, so an empty question text does pass and is POSTed; the doc wording is right there. But NaN weight cannot happen: onChange runs sanitizeNumber (31-35) which maps NaN/negative to 0 and clamps 0-100 integers, so a blank weight silently becomes 0 (the aria-invalid branch at 246 is dead). Also lib/crm/leadQualification.ts normaliseQuestions:97 drops questions with empty text on reload, so a blank question disappears silently after save. No zod schema at the form boundary; no duplicate/zero-question check.
- **Files to change:** `apps/web/src/app/_components/crm/QualificationFrameworksEditor.tsx`, `apps/web/src/lib/crm/leadQualification.ts`
- **Fix steps:**
  1. Add a zod schema (name min1, businessLine min1, questions array min1 of {text trim min1, weight int 0-100}) mirroring services/crm-service qualification-validators as described in the sanitizeNumber comment.
  2. Run schema.safeParse(fw) in save(); map issues to per-field messages and set aria-invalid on offending question inputs.
  3. Stop coercing empty weight to 0: keep the raw string in local state and validate on save so a blank weight is an error, not 0.
  4. Optionally warn on all-zero weights.
  5. Keep busyIdx disable (already present at 262).
- **Acceptance:**
  - Test: save with a blank question text shows error and does not call createFramework.
  - Test: blank weight is rejected, not sent as 0.
  - Valid framework still saves.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; tightens client validation only. Server validation remains authoritative.

### GAP-CRM-QUALIFICATION-FRAMEWORKS-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Business line is a free-text field (placeholder "government, psu") not tied to any business-line list, so frameworks can silently never match leads (QualificationFrameworksEditor.tsx:238).
- **Verified evidence:** Business line is a free-text <input> (QFE:206-207, placeholder 'e.g. government, psu'), saved verbatim after only a trim check (116). No business-line list exists in apps/web (grep for BUSINESS_LINES/business-line found nothing), and QualifyPanel/getFrameworks (leadQualification.ts:142-144) filters by the raw string, so a typo or case difference means the framework never matches a lead's businessLine. The theme tag FABRICATED is wrong; this is a free-text-vs-controlled-vocabulary issue.
- **Files to change:** `apps/web/src/app/_components/crm/QualificationFrameworksEditor.tsx`, `apps/web/src/lib/crm/leadQualification.ts`
- **Fix steps:**
  1. Confirm the authoritative business-line source (lead.businessLine values / a CRM reference endpoint) with backend; do not invent an endpoint.
  2. Replace the input with a <select> or combobox fed by that list; keep free-text only if backend confirms open vocabulary.
  3. Normalise (trim + lowercase) on save and on getFrameworks query if the vocabulary stays open.
  4. Show a hint listing business lines that currently have no active framework.
- **Acceptance:**
  - Selecting a business line saves the exact canonical value.
  - A framework with 'Government ' (trailing space/case) is normalised and matches a lead of business line 'government'.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; but changing the vocabulary may orphan existing frameworks saved with non-canonical values.

### GAP-CRM-QUALIFICATION-FRAMEWORKS-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** + Add framework sits in a separate top card and appends the new framework at the bottom of a long page without scrolling to it (QualificationFrameworksEditor.tsx:198).
- **Verified evidence:** '+ Add framework' (QFE:176-186) sits in the top card and does setFrameworks([...prev, blank]); the new card renders at the end of the list (197) with no scrollIntoView or focus call. With several frameworks the new card is off-screen and the user gets no feedback. Note: '+ Add question' (220) appends within the card so is fine.
- **Files to change:** `apps/web/src/app/_components/crm/QualificationFrameworksEditor.tsx`
- **Fix steps:**
  1. Give the new framework card a ref (or id keyed on frameworkRowIds) and after adding, call scrollIntoView({block:'nearest'}) and focus its Name input via an effect.
  2. Optionally prepend new drafts at the top instead of the bottom.
  3. Announce via existing message role=status: 'New framework added'.
- **Acceptance:**
  - Manual: with 5 frameworks click Add; the new card scrolls into view and Name is focused.
  - Component test: after click the Name input of the last card is document.activeElement.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.


---
## /crm/quotations  —  `crm/quotations.html`

- **Source:** `apps/web/src/app/(app)/crm/quotations/page.tsx`
- **Design reference:** `redesign/crm/quotations.html`

### GAP-CRM-QUOTATIONS-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The Approve button on a pending discount/deviation request is shown to every CRM user, including whoever raised it, with no role check or maker-checker split, and no Reject action although the decide endpoint supports "reject"; a requester can self-approve and unblock Send (apps/web/src/app/_components/crm/QuotationApprovalPanel.tsx:170, apps/web/src/lib/crm/quotation.ts:583-596).
- **Verified evidence:** QuotationApprovalPanel.tsx:169-173 renders an Approve button for every non-approved row for anyone who can open the page; no role check and no comparison of requester vs current user (panel has no identity or role input). Only approve is wired (grant, 97-110): lib/crm/quotation.ts:597-599 already exports rejectApproval(approvalId, reason) and decideApprovalRequest:581-591 posts {decision:'approve'|'reject'}, but the panel never calls reject, so a rejected/denied path is unreachable. A requester can therefore click Approve on their own request. Server enforcement of maker-checker is cannot-verify (crm-service not in snapshot).
- **Files to change:** `apps/web/src/app/_components/crm/QuotationApprovalPanel.tsx`, `apps/web/src/app/_components/crm/QuotationBuilder.tsx`, `apps/web/src/app/(app)/crm/quotations/page.tsx`, `apps/web/src/lib/crm/quotation.ts`
- **Fix steps:**
  1. In the server page.tsx read getSessionRoles() (lib/auth/roleGuard.ts) and pass canApprove (and current user id via a new getSessionUserId helper if available) to QuotationBuilder -> QuotationApprovalPanel.
  2. Hide/disable Approve when !canApprove or when approval.requestedBy === current user (only if the approvals API returns a requester field; otherwise this needs backend).
  3. Add a Reject button per pending row using a ConfirmDialog with requireReason that calls rejectApproval(a.id, reason).
  4. Render Rejected status distinctly in the status cell (currently non-approved shows red text of a.status).
  5. Confirm with backend that /quotation-approvals/:id/decide enforces role and requester != approver and emits an audit event.
- **Acceptance:**
  - Test: user without approver role sees no Approve/Reject buttons.
  - Test: requester of an approval cannot approve it (button disabled with reason).
  - Rejecting requires a reason and calls decide with decision 'reject'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approvals gate discounts and sending; a wrong role list would block legitimate approvers, so roles must come from backend policy, and server must remain authoritative.

### GAP-CRM-QUOTATIONS-02  ·  HIGH  ·  confirmed  ·  theme OTHER (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The list identifies a quotation only by Template, vN, line count, total and status: no quoteRef, account, opportunity or date columns, and New quotation has no account/opportunity field (they are only carried over from an opened record), so two "standard v1" quotes are indistinguishable and unlinked to a customer (QuotationBuilder.tsx:255-275,215).
- **Verified evidence:** QuotationBuilder list table (QB:311-340) columns are Template, Version, Lines, Total, Status, actions only: no quoteRef, account, opportunity or created date even though the Quotation model carries quoteRef/accountId/opportunityId (lib/crm/quotation.ts:267-281). startNew() (157-166) sets no account/opportunity and the New quotation form (365-384) has no such fields; createQuotation (QL:428-438) sends only dealId if q.opportunityId, so a from-scratch quote is unlinked to any customer. Theme DATEFMT is wrong.
- **Files to change:** `apps/web/src/app/_components/crm/QuotationBuilder.tsx`, `apps/web/src/lib/crm/quotation.ts`
- **Fix steps:**
  1. Add columns: Quote ref (q.quoteRef), Account, Opportunity, Created (formatIndianDate) to the list; resolve account/opportunity names via existing loaders or show the id with a link.
  2. Add account/opportunity pickers to the New quotation form (reuse existing CRM account/deal pickers if any; otherwise confirm the lookup endpoint with backend) and pass through Quotation.accountId/opportunityId.
  3. Extend normaliseQuotation to read createdAt and include it on Quotation.
  4. Include accountId in createQuotation body only if the API accepts it (backend check).
- **Acceptance:**
  - List shows a distinguishing Quote ref for two 'standard v1' rows.
  - A new quotation created from the page carries the chosen opportunity (dealId in POST body).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; quote linkage feeds convert-to-order, so verify dealId/account semantics with backend.

### GAP-CRM-QUOTATIONS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Save quotation on an existing record actually POSTs /new-version with a client-computed totalMinor yet reports "Quotation saved."; each save silently creates a superseding version, and a separate New version button clones without edits, so users cannot tell the two apart (lib/crm/quotation.ts:449-460, QuotationBuilder.tsx:190).
- **Verified evidence:** save() (QB:217-247) calls updateQuotation for an existing id, which POSTs /v1/crm/quotations/:id/new-version with lineItems+client-computed totalMinor (QL:448-458) and then shows 'Quotation saved.' (240). Each save therefore creates a superseding version. Separately, the 'New version' button (494) calls newQuotationVersion (QL:507-510) with no body, cloning unchanged. Extra bugs found: updateQuotation does not send the template, so a template change on an existing quote is silently dropped; after save, load() refreshes the list but `selected` still points at the old superseded row, so a second Save supersedes the wrong version. Server-side recompute of total is not verifiable.
- **Files to change:** `apps/web/src/app/_components/crm/QuotationBuilder.tsx`, `apps/web/src/lib/crm/quotation.ts`
- **Fix steps:**
  1. Rename button to 'Save as new version' and message to 'Saved as v{n+1}' for existing quotes; keep 'Create quotation' for new.
  2. Remove or relabel the duplicate 'New version' button ('Clone without changes'), or drop it.
  3. Have updateQuotation return the created row and setSelected to it (re-open via openQuote) after save.
  4. Send templateRef in the new-version body if the API accepts it (backend check), else disable the template select on saved quotes.
  5. Do not send client totalMinor if the server recomputes; confirm with backend.
- **Acceptance:**
  - After Save on v1 the header shows v2 and message names v2.
  - Editing the template on a saved quote either persists or is disabled.
  - Second save creates v3, not another v2.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium; versioning of commercial documents, wrong `selected` could supersede stale versions.

### GAP-CRM-QUOTATIONS-04  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Send, Accept, Reject, New version and Convert to order are all rendered regardless of status (a converted or rejected quote still offers Send/Accept), and Accept records a customer decision with no confirmation, note or evidence (QuotationBuilder.tsx:420-440).
- **Verified evidence:** The action row (QB:483-501) renders Send/Finalize, Accept, Reject, New version, Convert to order for any selected.id with only busy/blocking disabling; selected.status is never consulted, so accepted/rejected/converted quotes still offer Send/Accept. Reject (537-567) and Convert (537-548) do use ConfirmDialog (Reject requires a >=10-char reason), but Accept (488-490) runs acceptQuotation immediately with no confirm, note or evidence; QL:494-497 posts no body. Line numbers in the finding (420-440) are wrong; correct is 483-501.
- **Files to change:** `apps/web/src/app/_components/crm/QuotationBuilder.tsx`, `apps/web/src/lib/crm/quotation.ts`
- **Fix steps:**
  1. Compute allowed actions from selected.status (QuoteStatus in QL): Send only draft; Accept/Reject only sent; Convert only accepted; New version only non-converted. Hide or disable with title explaining why.
  2. Wrap Accept in ConfirmDialog with requireReason/minReasonLength for a customer-acceptance note (PO/email reference); extend acceptQuotation to send it only if the API supports a body (backend check).
  3. Confirm the backend rejects invalid transitions and emits audit events.
  4. Update button states after load() using the refreshed status.
- **Acceptance:**
  - Test: a 'converted' quote shows no Send/Accept buttons.
  - Accept opens a dialog and does not call the API until confirmed.
  - Draft quote does not offer Accept.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium; status gating must match the server state machine exactly or valid actions get hidden.
- **Depends on:** GAP-CRM-QUOTATIONS-03

### GAP-CRM-QUOTATIONS-06  ·  MEDIUM  ·  partly  ·  theme OTHER (was STATUS)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Template values are raw slugs shown with hyphens (government-tender, annual-contract) and Status prints the raw enum; Grand total has no CGST/SGST/IGST split for GST-registered supplies (QuotationBuilder.tsx:300,266,388).
- **Verified evidence:** Template raw slugs are shown in the list (QB:327 `q.template`) and the select options (369-373 render `t` as-is: government-tender, annual-contract); Status prints raw enum (331, also 352 and 522). Grand total (457-469) is net+tax summed across lines via quotationTotalMinor (QL:355-359) and per-line Tax is shown, but there is no total tax line and no CGST/SGST/IGST split; the model has no supplier/place-of-supply state, so a split cannot be computed client-side. Cited line 388 is wrong (386-470). Theme STATUS is partly right.
- **Files to change:** `apps/web/src/app/_components/crm/QuotationBuilder.tsx`, `apps/web/src/lib/crm/quotation.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add a TEMPLATE_LABELS map (Standard, Government tender, Annual contract) and use it in list and select.
  2. Render status via StatusPill (add draft/sent/accepted/rejected/converted tones) or humanizeStatus from lib/formatters.
  3. Add Subtotal / Total tax / Grand total rows in the tfoot from lineNetMinor/lineTaxMinor sums.
  4. GST split: requires supplier and customer state (place of supply); needs decision/backend fields before showing CGST/SGST vs IGST.
- **Acceptance:**
  - List shows 'Government tender' not 'government-tender'.
  - Footer shows subtotal, total tax, grand total; grand total unchanged.
  - Status shows a coloured pill.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low for labels; GST split affects tax invoices and needs a decision.


---
## /crm/rti  —  `crm/rti.html`

- **Source:** `apps/web/src/app/(app)/crm/rti/page.tsx`
- **Design reference:** `redesign/crm/rti.html`

### GAP-CRM-RTI-01  ·  HIGH  ·  confirmed  ·  theme STATUS (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The Overdue tile and the red "N d overdue" SLA badge ignore status: a RESPONDED or DISPOSED request past its original due date still counts as overdue and shows a red badge, while Open excludes those statuses, so the tiles contradict each other and closed RTIs read as statutory breaches (apps/web/src/app/(app)/crm/rti/page.tsx:33-40, RtiTable.tsx:21-44).
- **Verified evidence:** rti/page.tsx:318-324: overdue = daysLeft(dueAt)<0 and critical = <7 days ignore status, while open excludes RESPONDED and DISPOSED only (REJECTED, appeals still count). RtiTable.tsx SlaBadge (390-420) also ignores status, so a RESPONDED/DISPOSED row past due shows red 'Nd overdue'. Tiles are labelled '(this page)'. Also uses new Date(dueAt).toLocaleDateString at 525 rather than formatIndianDate, and Math.ceil on ms loses IST day boundaries. Cited lines 33-40 are off; correct 318-324 and 390-420.
- **Files to change:** `apps/web/src/app/(app)/crm/rti/page.tsx`, `apps/web/src/app/(app)/crm/rti/RtiTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Extract a helper isRtiClosed(status) (RESPONDED, DISPOSED, and decide on REJECTED) in a shared rti util and use it in page.tsx counts and SlaBadge.
  2. SlaBadge returns a neutral 'Responded' badge (or nothing) for closed statuses; keep countdown for open ones.
  3. Apply the same closed filter to overdue and critical counts.
  4. Format the due date with formatIndianDate.
- **Acceptance:**
  - RESPONDED row with past dueAt: no red badge, not counted as overdue.
  - Open row past due is counted and red.
  - Overdue + Critical + not-due sums are consistent with Open.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; statutory-breach signalling must not hide genuine overdue open items.

### GAP-CRM-RTI-02  ·  HIGH  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The loader is hard-wired to limit=50, page=1 and the table has no pagination, so RTI requests beyond the first 50 cannot be reached from this register even though the Total tile can be larger; the URL filters ?status/?section/?search work only if typed by hand (apps/web/src/app/_data/loaders.ts:1606, rti/page.tsx:8-20).
- **Verified evidence:** loaders.ts:1601-1613 getCrmRti defaults limit 50, page 1; rti/page.tsx:302-306 passes only status/section/search from searchParams and never page/limit; RtiTable (DataTable, no pagination props) renders only rows. data.total is shown in the 'Total' tile so it can exceed the visible 50. There are no filter/search controls in the UI (only hand-typed ?status=, ?section=, ?search=). Tiles are labelled '(this page)', which is honest but unhelpful, and the counts are computed on 50 rows only.
- **Files to change:** `apps/web/src/app/(app)/crm/rti/page.tsx`, `apps/web/src/app/(app)/crm/rti/RtiTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Read page and limit from searchParams in page.tsx and pass to getCrmRti.
  2. Add a pager (prev/next + 'Showing a-b of total') using data.total; reuse an existing pagination component if present in ds.
  3. Add filter controls (status select, section select, search box) that update the URL.
  4. Get status counts (open/overdue/critical) from the API if available; otherwise keep 'this page' labels.
- **Acceptance:**
  - With 120 rows, page 3 shows rows 101-120 and Next is disabled.
  - Choosing status FIRST_APPEAL filters via URL and total updates.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-CRM-RTI-03  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Status colour carries no meaning: StatusPill maps only a few words, so RECEIVED, TRANSFERRED, RESPONDED, FIRST_APPEAL, SECOND_APPEAL and DISPOSED all fall back to the same "info" pill; only REJECTED is distinct, and the raw enum (e.g. FIRST_APPEAL) is printed as the label (RtiTable.tsx:137, ds/StatusPill.tsx:4-40).
- **Verified evidence:** ds/StatusPill.tsx:5-36 STATUS_MAP has no keys for received, transferred, responded, first_appeal, second_appeal, disposed (lookup is status.toLowerCase(), so 'first_appeal'), so they fall to 'info'; only 'rejected' maps (bad). RtiTable.tsx:540-543 passes label={r.status}, printing raw 'FIRST_APPEAL' (the detail page omits label so it humanizes). Note a status 'open' maps to good but is unused here.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/crm/rti/RtiTable.tsx`
- **Fix steps:**
  1. Add first_appeal/second_appeal warn, responded good, disposed mut, received info, transferred info to STATUS_MAP (underscore keys), or replace with the existing STATUS_TONE in RtiTable (426-434, currently unused).
  2. Remove label={r.status} in RtiTable so humanizeStatus applies ('First appeal').
  3. Delete the dead STATUS_TONE map if not used.
- **Acceptance:**
  - StatusPill status='FIRST_APPEAL' renders warn variant and text 'First appeal'.
  - RESPONDED renders good.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; StatusPill is shared, adding keys only changes unmapped statuses.

### GAP-CRM-RTI-04  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The list shows applicant full names to every CRM user with no role gate or masking; RTI applicant identity is personal data under DPDP and the page has no purpose-limited access note (RtiTable.tsx:118).
- **Verified evidence:** RtiTable.tsx:511-517 renders applicantName in clear for every viewer in the list; no masking, role gate, or purpose note. No shared <Masked> exists in ds. Cited line 118 is wrong; correct 511-517. Server-side access logging cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/crm/rti/RtiTable.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`
- **Fix steps:**
  1. Use the shared Masked component (see GAP-CRM-RTI-DETAIL-03) for the applicant column, e.g. show initials/first name only in the list.
  2. Pass canReveal from page.tsx via getSessionRoles.
  3. Keep full name only on the detail page behind reveal+audit.
- **Acceptance:**
  - List shows masked names for non-privileged users.
  - Search by name still works server-side.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium; officers may need to identify applicants at a glance.
- **Depends on:** GAP-CRM-RTI-DETAIL-03

### GAP-CRM-RTI-05  ·  MEDIUM  ·  confirmed  ·  theme COPY (was LOADING)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Empty state says "No RTI requests match the current filters." although there are no filter controls; loading.tsx uses a different subtitle ("30-day response register") from the page ("30-day statutory response register") (RtiTable.tsx:146, rti/loading.tsx:9).
- **Verified evidence:** RtiTable.tsx:548 emptyMessage 'No RTI requests match the current filters.' while the page has no filter controls (only URL params); rti/loading.tsx:5 subtitle is '...30-day response register.' vs page.tsx:332 '...30-day statutory response register.' Both copy issues are real; cited lines 146 and 9 are off.
- **Files to change:** `apps/web/src/app/(app)/crm/rti/RtiTable.tsx`, `apps/web/src/app/(app)/crm/rti/loading.tsx`, `apps/web/src/app/(app)/crm/rti/page.tsx`
- **Fix steps:**
  1. Change empty copy to 'No RTI requests recorded yet' when no filters/params, keep 'match the filters' only when searchParams has values (pass hasFilters prop).
  2. Share the subtitle string via a const used by page.tsx and loading.tsx.
  3. Add a 'New RTI Request' CTA in the empty state.
- **Acceptance:**
  - Empty register without filters shows the 'none yet' copy.
  - Loading and loaded subtitles are identical.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.
- **Depends on:** GAP-CRM-RTI-02

### GAP-CRM-RTI-06  ·  LOW  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W2 2026-10-16: closed by #TBD, W2 crm: closed by #93e2de01d)
- **W0-10 note:** review found the W0 tick partly — lib/crm/rti.ts sectionLabel + test exist and detail page imports it, but RtiTable.tsx:82-86 and new/page.tsx:12-15 keep local maps (i18n keys): table shows "§6 Information" vs detail/new "§6 — Information Request", filters namespace shows "§6 — Information" - acceptance "all screens show the same label" unmet
- **First-pass claim:** Section reads "§6 Information" here but "§6 — Information Request" on the detail and new-request screens (RtiTable.tsx:55, rti/[id]/page.tsx:37).
- **Verified evidence:** RtiTable.tsx:436-440 sectionLabel returns '§6 Information' / '§11 Third-party' while detail (page.tsx:34-37) and new (new/page.tsx:8-11) use '§6 — Information Request' / '§11 — Third-party Information'. Three separate label maps; theme WIRING is wrong (pure label drift).
- **Files to change:** `apps/web/src/app/(app)/crm/rti/RtiTable.tsx`, `apps/web/src/app/(app)/crm/rti/[id]/page.tsx`, `apps/web/src/app/(app)/crm/rti/new/page.tsx`, `apps/web/src/lib/crm/rti.ts (new)`
- **Fix steps:**
  1. Create lib/crm/rti.ts exporting RTI_SECTIONS and sectionLabel(value, short?).
  2. Replace the three local maps with imports; use the full label everywhere, or a documented short form only in the table.
  3. Handle unknown section by returning the raw value.
- **Acceptance:**
  - All three screens show the same label for s.6.
  - Unit test for sectionLabel.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.


---
## /crm/rti/[id]  —  `crm/rti-detail.html`

- **Source:** `apps/web/src/app/(app)/crm/rti/[id]/page.tsx`
- **Design reference:** `redesign/crm/rti-detail.html`

### GAP-CRM-RTI-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13: closed by #1858, verified on main 9c5e9e9e9; W1 SF-12 re-confirmed on #2003)
- **First-pass claim:** Statuses FIRST_APPEAL and SECOND_APPEAL (and DISPOSED) fall through to "no further action available here", so once First Appeal is raised nothing in the UI can decide, forward or close it; the statutory appeal chain dead-ends at the button that starts it (apps/web/src/app/(app)/crm/rti/[id]/RtiActions.tsx:27,35).
- **Verified evidence:** RtiActions.tsx:214-215 canProgress = RECEIVED|TRANSFERRED, canAppeal = RESPONDED|REJECTED; any other status (FIRST_APPEAL, SECOND_APPEAL, DISPOSED) hits the early return at 229-235 'no further action available here'. The file header comment (208-210) states there is no backend route for second appeal or disposal, and nothing exists to decide a first appeal. Confirmed as a real dead end; fix needs backend routes (crm-service absent, cannot see). Cited lines 27,35 are wrong; correct 214-235.
- **Files to change:** `apps/web/src/app/(app)/crm/rti/[id]/RtiActions.tsx`, `apps/web/src/app/(app)/crm/rti/[id]/page.tsx`
- **Fix steps:**
  1. Agree with backend the appeal-chain endpoints (decide first appeal, escalate to second appeal, dispose); do not call them until they exist.
  2. Add FIRST_APPEAL actions (Decide appeal with required order text, Escalate to second appeal) and SECOND_APPEAL/DISPOSED actions (Dispose with reason) via ActionButton.
  3. Meanwhile replace the dead-end text with an explicit message naming who handles the appeal outside the system.
  4. Show first-appeal due date prominently (already r.firstAppealDueAt at page.tsx:108).
- **Acceptance:**
  - Test: FIRST_APPEAL status renders decide/escalate actions.
  - DISPOSED shows read-only with disposal date.
  - Each action calls the correct PATCH and refreshes.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** High; statutory RTI workflow with legal deadlines, needs backend state machine and audit.

### GAP-CRM-RTI-DETAIL-02  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13: closed by #1858, verified on main 9c5e9e9e9; W1 SF-12 re-confirmed on #2003)
- **First-pass claim:** Forward, Respond and First Appeal are offered to every CRM user: the CPIO/APIO roles are not modelled, and the recorded response (a statutory document) needs only a 1-character "Response text" with no draft, attachment or preview (RtiActions.tsx:35-75, ds/ConfirmDialog.tsx:72).
- **Verified evidence:** True: Forward/Respond/First Appeal (RtiActions.tsx:239-271) are shown to any user who reaches the page by status only; no role/CPIO/APIO check (header lists CPIO only in comments). Respond uses ActionButton requireReason with default minReasonLength=1 (ConfirmDialog.tsx:72,174), so a 1-char response is accepted, no attachment/preview/draft. Overstated: all three actions do go through a ConfirmDialog (ActionButton) and Forward/Respond require non-empty text. Whether the server enforces roles and emits audit events is cannot-verify. Cited ConfirmDialog line 72 is the minReasonLength default.
- **Files to change:** `apps/web/src/app/(app)/crm/rti/[id]/RtiActions.tsx`, `apps/web/src/app/(app)/crm/rti/[id]/page.tsx`
- **Fix steps:**
  1. Pass canAct (from getSessionRoles in the server page, roles agreed with backend for CPIO/APIO) into RtiActions and hide/disable the actions otherwise.
  2. Set minReasonLength (e.g. 20-50) and maxReasonLength on the Respond ActionButton; relabel reasonLabel 'Response to applicant'.
  3. Add a review step showing the text before sending (use confirmDescription with the text or a two-step dialog).
  4. Confirm audit event on PATCH respond/forward in backend.
- **Acceptance:**
  - Respond with 5 chars is rejected client-side.
  - User without CPIO role sees no action buttons.
  - Response text is shown in the confirm step.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High; RTI response is a statutory record. Role list must come from backend/policy.

### GAP-CRM-RTI-DETAIL-03  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13: closed by #1858, verified on main 9c5e9e9e9; W1 SF-12 re-confirmed on #2003)
- **First-pass claim:** Applicant name and contact (phone/email) print in clear to all CRM users with no masking or reveal-with-reason; under DPDP the applicant's identity and contact should be role-gated and access-logged (rti/[id]/page.tsx:160-170).
- **Verified evidence:** Detail page prints applicantName and applicantContact in clear to any viewer (page.tsx:162-165) with no masking or access logging; the list does the same (RtiTable.tsx:511-517). There is no shared <Masked> component in ds (only ad-hoc secretMasked strings in admin/integrations). Whether the server audit-logs reads is cannot-verify. Line refs 160-170 are approximately right.
- **Files to change:** `apps/web/src/app/(app)/crm/rti/[id]/page.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Create ds/Masked.tsx: props {value, kind:'phone'|'email'|'name', canReveal, onReveal}; shows partially masked value and a Reveal button (client component).
  2. Reveal calls a backend audit endpoint (needs backend: read-access log with reason); do not invent it until agreed.
  3. Use it for applicantContact (and name on list) in page.tsx; canReveal from getSessionRoles.
  4. Add purpose note 'Personal data of RTI applicant, access is logged'.
- **Acceptance:**
  - Non-privileged user sees masked contact, no reveal button.
  - Privileged reveal logs an audit event and shows full value.
  - Snapshot test for Masked formats.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; CPIO staff need the contact to reply, so over-masking hurts workflow.
- **Depends on:** GAP-CRM-RTI-04

### GAP-CRM-RTI-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1859, verified on main 9c5e9e9e9; W1 SF-12 re-confirmed on #2003)
- **First-pass claim:** Forward asks for a free-text "Department / Office" that overwrites departmentRef; there is no department picker, no record of the previous department, and no check of the s.6(3) transfer window (RtiActions.tsx:39).
- **Verified evidence:** Forward (RtiActions.tsx:242-248) uses the ConfirmDialog reason box labelled 'Department / Office' and sends {departmentRef:dept} to PATCH /forward; the value is free text that replaces departmentRef (page.tsx:100 shows only the current value). The UI keeps no previous-department history and does not check the s.6(3) 5-day transfer window (only text in the description). Backend behaviour on history is cannot-verify. Cited line 39 is wrong; correct 242-248.
- **Files to change:** `apps/web/src/app/(app)/crm/rti/[id]/RtiActions.tsx`, `apps/web/src/app/(app)/crm/rti/[id]/page.tsx`
- **Fix steps:**
  1. Replace the reason box with a department select/combobox reusing a shared public-authority list (shared with rti/new, see GAP-CRM-RTI-NEW-04).
  2. Add a separate 'transfer note' field if backend supports it.
  3. Show a 'Transferred from X on date' line, requires backend to return previousDepartmentRef/transferredAt (do not invent; confirm).
  4. Warn when now - receivedAt exceeds 5 days (s.6(3)).
- **Acceptance:**
  - Forwarding requires selecting a listed authority.
  - After forward the detail page shows previous department if the API returns it.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; transfer changes statutory ownership of the request.
- **Depends on:** GAP-CRM-RTI-NEW-04

### GAP-CRM-RTI-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13: closed by #1859, verified on main 9c5e9e9e9; W1 SF-12 re-confirmed on #2003)
- **First-pass claim:** Fee prints "₹" + a raw JS number (e.g. ₹10, ₹2.5) instead of paise-based lakh-grouped formatMoney, breaking the platform money rule (rti/[id]/page.tsx:118).
- **Verified evidence:** page.tsx:102 renders `Paid — ₹${r.feeAmount}` with the raw JS number (RtiDetail.feeAmount?: number, line 17), so 10 prints ₹10 and 2.5 prints ₹2.5, with no formatRupees/formatMoney (formatters.ts:67,90). The amount is in rupees not paise (see RTI-NEW-01), so the fix depends on the contract. Cited line 118 is wrong; correct 102.
- **Files to change:** `apps/web/src/app/(app)/crm/rti/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Short term: render with formatRupees(r.feeAmount) (formatters.ts:67) so it shows lakh grouping and 2 decimals.
  2. After the backend moves to feeAmountMinor (GAP-CRM-RTI-NEW-01), switch to formatMoney(feeAmountMinor).
  3. Show '—' if feePaid true but amount missing.
- **Acceptance:**
  - feeAmount 10 renders ₹10.00; 2.5 renders ₹2.50.
  - feeAmount 150000 renders with Indian grouping.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-RTI-NEW-01

### GAP-CRM-RTI-DETAIL-06  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1859, verified on main 9c5e9e9e9; W1 SF-12 re-confirmed on #2003)
- **First-pass claim:** A failed or forbidden load is shown as "RTI Request Not Found — The RTI request could not be loaded." so a network outage, a 403 and a genuine 404 look identical; there is no timeline of forward/respond events beyond "Last Updated" (rti/[id]/page.tsx:60-66).
- **Verified evidence:** page.tsx:44-67: fetchJson result's status/errorCode are ignored; any null (network error, 401/403, 404, invalid payload) renders the same 'RTI Request Not Found' header and 'could not be loaded' text. A DataSourceBadge is shown when source==='error' (61) so failure is partly signalled, but the title still says Not Found and 403 vs 404 are not distinguished; fetchJson returns status (apiClient.ts:144) and ds/LoadErrorState.tsx already maps 403 to PermissionDenied and others to RefreshErrorState. Also no timeline of forward/respond events exists (only Last Updated), and the response-record shows in a Response card. There is no notFound() call. Cited lines 60-66 fit.
- **Files to change:** `apps/web/src/app/(app)/crm/rti/[id]/page.tsx`
- **Fix steps:**
  1. Keep the full fetchJson result; if source==='error' render <LoadErrorState result={result} area='RTI request' backHref='/crm/rti' />.
  2. Only when status===404 call notFound() / show 'Not found'.
  3. Timeline needs backend event history endpoint (not visible); until then label Last Updated only.
- **Acceptance:**
  - Mock 500: page shows retry error state, not 'Not Found'.
  - Mock 403: PermissionDenied shown.
  - Mock 404: not-found page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /crm/rti/new  —  `crm/rti-new.html`

- **Source:** `apps/web/src/app/(app)/crm/rti/new/page.tsx`
- **Design reference:** `redesign/crm/rti-new.html`

### GAP-CRM-RTI-NEW-01  ·  HIGH  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** feeAmount is sent as a JSON number in rupees (Number("10.00")), not as paise, contradicting the platform rule that money travels as paise bigint; float rounding is possible and the detail page later prints it unformatted (apps/web/src/app/(app)/crm/rti/new/page.tsx:39,62).
- **Verified evidence:** rti/new/page.tsx:35,44 sends feeAmount: Number(feeAmountRaw) from a type=number step=0.01 input (254-261), i.e. rupees as a JSON float, contrary to CLAUDE.md paise rule; detail page and RtiDetail/CrmRtiRow (loaders.ts feeAmount number) treat it as rupees too. Whether the API accepts feeAmountMinor is cannot-verify (services/crm-service absent), so this needs a contract change. Lines 39,62 cited are off; correct 35,44.
- **Files to change:** `apps/web/src/app/(app)/crm/rti/new/page.tsx`, `apps/web/src/lib/money.ts`, `apps/web/src/app/(app)/crm/rti/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Agree with backend a paise field (e.g. feeAmountMinor as integer/string) and migrate the stored value.
  2. In new/page.tsx convert with rupeesToMinorString (lib/money.ts, already used in QuotationBuilder) instead of Number().
  3. Update CrmRtiRow/RtiDetail types and render with formatMoney.
  4. Validate max 2 decimals at the boundary (zod).
- **Acceptance:**
  - Entering 10.10 sends 1010 (paise), not 10.1.
  - Detail page shows ₹10.10 from the stored value.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium; contract change affects existing stored RTI fee values (migration).

### GAP-CRM-RTI-NEW-03  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Applicant name and free-text contact are collected with no DPDP purpose note and no contact-format check, unlike the citizen feedback form which carries a consent statement (rti/new/page.tsx:235-255, voice-of-customer/feedback/page.tsx).
- **Verified evidence:** new/page.tsx:212-234 collects applicantName (required) and free-text applicantContact (maxLength 200, no pattern/type) with no DPDP purpose or notice text; the citizen feedback form has an explicit consent checkbox (voice-of-customer/feedback/page.tsx:215-238). Mitigation: this is an officer-side register entry on behalf of an applicant, so the correct control may be a notice/lawful-basis statement rather than a consent checkbox (decision). No contact format validation exists.
- **Files to change:** `apps/web/src/app/(app)/crm/rti/new/page.tsx`
- **Fix steps:**
  1. Add a short purpose notice under Applicant Details ('Used only to process this RTI request under the RTI Act 2005; retained per schedule') after legal wording is approved.
  2. Validate contact: accept an Indian mobile (10 digits) or an email via zod/regex on submit; show field error.
  3. Consider split fields (phone, email) for later masking.
- **Acceptance:**
  - Invalid contact 'abc' shows a field error and blocks submit.
  - Purpose notice is visible in the form.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; wording needs legal/DPO sign-off.

### GAP-CRM-RTI-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [~] **Status** NEEDS OWNER DECISION — web part done (canonicaliseAuthority, commit 936241a8d); backend tenant-authorities endpoint requires owner decision before combobox can be wired
- **W0-10 note:** review found the W0 tick partly — rtiAuthorities.ts is still a hard-coded central-bodies list (DECISION noted), not tenant/org sourced, so a configured state department does not appear; new/page.tsx:101 uses normaliseAuthority (trim/collapse only), not canonicaliseAuthority, so ministry of finance does not fold to canonical casing
- **First-pass claim:** "Department / Public Authority" is free text with a datalist of central bodies (Ministry of Finance, UIDAI, Department of Posts); a state department's own public authorities are not offered and typos fracture the register (rti/new/page.tsx:15-24,150).
- **Verified evidence:** new/page.tsx:13-22 SAMPLE_DEPARTMENTS is a hard-coded list of 8 central bodies fed to a <datalist> (164-168) on a free text input (156-163, required, maxLength 200); anything can be typed, so typos fracture the register and state authorities are not offered. Cited lines 15-24,150 are roughly right (13-22,156).
- **Files to change:** `apps/web/src/app/(app)/crm/rti/new/page.tsx`
- **Fix steps:**
  1. Source public authorities from tenant/org config (confirm an endpoint with backend; do not invent) instead of the hard-coded list.
  2. Use a combobox that allows a controlled 'Other' with normalised text (trim, collapse spaces).
  3. Share the same list with Forward in RtiActions.tsx.
  4. Rename SAMPLE_DEPARTMENTS if it stays a fallback.
- **Acceptance:**
  - A state department configured for the tenant appears in suggestions.
  - Typing 'ministry of finance ' normalises to the canonical name.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-RTI-NEW-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Fee Paid? and Fee Amount are independent: "No" with an amount, or "Yes" with none, both submit (rti/new/page.tsx:262-285).
- **Verified evidence:** new/page.tsx:246-262: Fee Paid select and Fee Amount input are uncoupled; handleSubmit (29-45) sends feePaid and feeAmount independently, so 'No'+amount and 'Yes'+empty both submit. RtiDetail then prints 'Paid' without amount or 'Not paid' hiding the amount. No client validation; server validation cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/crm/rti/new/page.tsx`
- **Fix steps:**
  1. Controlled state for feePaid; disable and clear Fee Amount when No.
  2. When Yes, make Fee Amount required (or allow 0 for exempt/BPL with an explicit checkbox).
  3. Validate in handleSubmit with zod before fetch and show field error via formError.fieldError.
- **Acceptance:**
  - Selecting No disables the amount.
  - Yes with empty amount blocks submit with an error.
  - Valid combos submit.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-CRM-RTI-NEW-01

### GAP-CRM-RTI-NEW-06  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The route has no loading.tsx or error.tsx of its own, so it shows the list skeleton while loading and an error page named "RTI Requests" (rti/loading.tsx, rti/error.tsx).
- **Verified evidence:** rti/new has no loading.tsx or error.tsx (directory contains only page.tsx), so it inherits rti/error.tsx, whose RouteError uses area='RTI Requests' and backHref '/crm' (error.tsx:9-13). New is a client component so the loading.tsx of rti/ (list skeleton with 4 stat tiles) shows on navigation. Real but minor. Note rti/[id] has its own loading/error.
- **Files to change:** `apps/web/src/app/(app)/crm/rti/new/loading.tsx (new)`, `apps/web/src/app/(app)/crm/rti/new/error.tsx (new)`
- **Fix steps:**
  1. Add new/loading.tsx with a form-shaped skeleton (PageHeader 'New RTI Request' + panel).
  2. Add new/error.tsx using RouteError with area='New RTI request', backHref='/crm/rti', backLabel='Back to RTI Requests'.
- **Acceptance:**
  - Navigating to /crm/rti/new shows a form skeleton, not stat tiles.
  - Throwing in the page shows an error titled for the new request with a link back to the register.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.


---
## /crm/service-requests  —  `crm/service-requests.html`

- **Source:** `apps/web/src/app/(app)/crm/service-requests/page.tsx`
- **Design reference:** `redesign/crm/service-requests.html`

### GAP-CRM-SERVICE-REQUESTS-01  ·  HIGH  ·  confirmed  ·  theme PAGINATION (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The register loads only the first 50 rows (limit=50, page=1) and then pages, sorts and searches those rows in the browser, so "Page 1 of 4" and the search box silently cover a fraction of the total (the Total tile can read 132); older requests are unreachable and the ?status/?search params are never set by any control (apps/web/src/app/_data/loaders.ts:1554, service-requests/ServiceRequestsTable.tsx:105).
- **Verified evidence:** getCrmServiceRequests (loaders.ts, ~1530-1560) always sends limit=50&page=1 (params default). The page (service-requests/page.tsx:8-14) forwards only status/priority/serviceType/search from searchParams and has no page param; no control in page.tsx or ServiceRequestsTable.tsx sets those params. The table (ServiceRequestsTable.tsx:154-159) uses DataTable with client-side sortable/filterable/pageSize=15 over the 50 rows, so search/sort cover only the first 50 while the Total tile uses data.total (meta.total). Confirmed.
- **Files to change:** `apps/web/src/app/(app)/crm/service-requests/page.tsx`, `apps/web/src/app/(app)/crm/service-requests/ServiceRequestsTable.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Add page and pageSize to SP and pass to getCrmServiceRequests (limit=15/25, page=n); use meta.total for the pager.
  2. Add a filter bar (status, priority, serviceType, search with submit/debounce) as a client component that pushes searchParams via router.replace.
  3. Make ServiceRequestsTable render Prev/Next server-driven (check whether DataTable supports server mode; else add a `serverPagination` prop or a small Pager component) and disable client filterable/sortable.
  4. Keep useSeededResource key varying by query string so cache is not shared across pages.
- **Acceptance:**
  - Test: total 132 shows 'Page 1 of 9' and page 2 fetches page=2.
  - Manual: search 'water' returns matches from beyond first 50 rows.
  - ?status=pending pre-selects filter and requests status=pending.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Stat tiles and CSV export scope change; offline seeded cache keying needs care.
- **Depends on:** GAP-CRM-SERVICE-REQUESTS-05

### GAP-CRM-SERVICE-REQUESTS-02  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-08 #2012 (export is permission-gated and fail-closed audited): closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** ⬇ CSV exports the loaded rows including citizen names to any CRM user with no role gate, purpose prompt or audit note; citizen names are personal data under DPDP (ServiceRequestsTable.tsx:112, ds/DataTable.tsx:298).
- **Verified evidence:** ServiceRequestsTable.tsx:159-160 sets exportable + exportFilename; DataTable.tsx:267-292 downloadCsv writes every column value (ref, citizen name, service type, subject, priority, status, created) for all sorted rows from the client, with no role check, purpose prompt or audit call. The CRM layout admits crm_user and above, so any of them can export. Cells are also not protected against CSV formula injection. Observation's line 112/298 approximate.
- **Files to change:** `apps/web/src/app/(app)/crm/service-requests/ServiceRequestsTable.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/app/(app)/crm/service-requests/page.tsx`
- **Fix steps:**
  1. Add optional `onExport`/`canExport` props to DataTable; hide the button unless canExport (crm_admin) - reuse roleGuard helpers.
  2. Show a ConfirmDialog with required purpose text before download, and POST an audit event 'crm.service-requests.exported' (row count, filters, purpose) - confirm audit endpoint with backend.
  3. Exclude or mask citizenName in the export unless the user has the privileged role.
  4. Prefix cells starting with = + - @ with an apostrophe in csvCellValue.
- **Acceptance:**
  - Test: crm_user does not see CSV button; crm_admin sees it and must enter purpose.
  - Manual: export emits an audit event.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DataTable is shared; new props must default to current behaviour so other tables are unaffected.
- **Depends on:** <Masked> shared component

### GAP-CRM-SERVICE-REQUESTS-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** dueAt and assignedTo are fetched but never shown, so the list cannot show which requests are past due or who owns them, the two things a citizen-service desk sorts by (loaders.ts:1499).
- **Verified evidence:** CrmServiceRequestRow includes assignedTo and dueAt and the loader maps them (loaders.ts ~1493-1494, mapping ~1552-1553), but ServiceRequestsTable.tsx columns (105-152) render only ref, citizen, service type, subject, priority, status, logged, View. No overdue signal or owner.
- **Files to change:** `apps/web/src/app/(app)/crm/service-requests/ServiceRequestsTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add 'Assigned to' column (name via directory lookup, 'Unassigned' fallback) and 'Due' column.
  2. Render an Overdue pill (StatusPill 'overdue' maps to bad) when dueAt < now and status is open/in_progress/pending.
  3. Add Overdue and Assigned-to-me filters once server-side filtering exists (see -01).
  4. Allow sorting by dueAt.
- **Acceptance:**
  - Test: row with past dueAt and status open shows Overdue; resolved row does not.
  - Manual: owner column shows a name, not an id.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Owner id-to-name lookup adds a request; if unavailable show 'Assigned' rather than a raw uuid.
- **Depends on:** GAP-CRM-SERVICE-REQUESTS-01

### GAP-CRM-SERVICE-REQUESTS-04  ·  MEDIUM  ·  partly  ·  theme STATUS

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Priority uses colour alone to separate urgent/high from normal/low, and normal and low share one grey; StatusPill leaves in_progress, resolved and cancelled on the same blue as unknown values (ServiceRequestsTable.tsx:11, ds/StatusPill.tsx:4-40).
- **Verified evidence:** ServiceRequestsTable.tsx:11-16 PRIORITY_TONE maps normal and low both to var(--ink2), so those two are identical; however the badge renders the priority word via titleCase (line ~130), so priority is not colour-only. StatusPill.tsx STATUS_MAP has 'in progress' (space) but the value is 'in_progress' (lookup is status.toLowerCase() at line 53, no underscore normalisation), and has no 'resolved' or 'cancelled', so all three fall to the 'info' (blue) fallback; 'open' maps to 'good' (green), which is questionable for a new request. Also the colour contrast of white text on var(--warn) is unchecked.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/crm/service-requests/ServiceRequestsTable.tsx`, `apps/web/src/app/(app)/crm/service-requests/[id]/page.tsx`
- **Fix steps:**
  1. In StatusPill add keys 'in_progress' (warn), 'resolved' (good), 'cancelled' (mut), or normalise underscores to spaces before lookup.
  2. Reconsider 'open' as 'info' for CRM/tickets; if changed, check other StatusPill callers.
  3. Extract a shared PriorityBadge (used in table and [id]/page.tsx PriorityBadge) with distinct tones for normal (mut) and low (outline/lighter), keep the text label.
  4. Verify contrast of badge text with tokens.
- **Acceptance:**
  - Unit test: StatusPill status='in_progress' renders warn variant; 'cancelled' renders mut.
  - Visual check: Normal and Low badges differ.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** StatusPill is shared app-wide; mapping changes alter colours on other screens using 'open' - only add keys, do not change 'open' without a sweep.

### GAP-CRM-SERVICE-REQUESTS-05  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Stat tiles are labelled "(this page)" but count only the loaded 50 rows regardless of the 15-row pager, so Open + Pending + Closed does not add up to Total (service-requests/page.tsx:20-24).
- **Verified evidence:** service-requests/page.tsx:18-21 compute Open/Pending/Closed from data.rows (first 50 rows) and the labels say '(this page)' (45-47), while the visible pager is 15 rows so 'this page' is misleading; Total uses data.total (48). Cancelled requests are counted in none of the three tiles, and Open+Pending+Closed of loaded rows will not equal Total once >50 rows. Theme I18N is wrong; this is a counts/labelling issue.
- **Files to change:** `apps/web/src/app/(app)/crm/service-requests/page.tsx`
- **Fix steps:**
  1. Prefer server-side counts: request per-status totals (meta or count query) from the API; if unavailable, drop the '(this page)' tiles and keep Total.
  2. Otherwise relabel to 'in the latest 50' and add a 'Cancelled' tile so the parts sum, with a note when total > rows.length.
  3. Show '—' when source is error (already done via stat()).
- **Acceptance:**
  - Test: 132 total/50 loaded shows either server counts summing to 132 or explicit 'latest 50' labels.
  - Cancelled request counted somewhere.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Tiles are a management view; wrong sums undermine trust.
- **Depends on:** GAP-CRM-SERVICE-REQUESTS-01

### GAP-CRM-SERVICE-REQUESTS-06  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx is the generic three-bar template with no tiles or table shape, unlike the list it precedes (service-requests/loading.tsx).
- **Verified evidence:** service-requests/loading.tsx is three Tailwind pulse bars (h-4, h-9, h-80) inside min-h-screen p-6 - no tile row, no table header rows, and uses a different structure from sibling loading files (voice-of-customer/loading.tsx uses page-main/ph with four tile skeletons). Confirmed but cosmetic.
- **Files to change:** `apps/web/src/app/(app)/crm/service-requests/loading.tsx`
- **Fix steps:**
  1. Rewrite to match page shape: page-main with PageHeader skeleton, four StatCard skeletons (StatGrid), then a table skeleton with header and ~8 row bars; reuse any shared skeleton component in ds if present.
  2. Apply the same pattern to service-requests/[id]/loading.tsx and new/loading.tsx if they are generic.
  3. Add aria-busy/role=status for accessibility.
- **Acceptance:**
  - Manual: throttle network; skeleton shows 4 tiles and a table outline matching the final layout, no layout jump.
  - No visual regression in dark mode.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /crm/service-requests/[id]  —  `crm/service-requests-detail.html`

- **Source:** `apps/web/src/app/(app)/crm/service-requests/[id]/page.tsx`
- **Design reference:** `redesign/crm/service-requests-detail.html`

### GAP-CRM-SERVICE-REQUESTS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Every status change sends its reason in the `resolution` field, including "What is it waiting on?" for Mark pending and Closing remarks for Close; a pending request then shows a "Resolution" card ("Resolved —") that is really a waiting note, and the true resolution text is overwritten by closing remarks (apps/web/src/app/(app)/crm/service-requests/[id]/ServiceRequestActions.tsx:18-24,45, [id]/page.tsx:127).
- **Verified evidence:** ServiceRequestActions.tsx:33-41 setStatus(next, resolution) sends the single reason as body.resolution for every transition; Mark pending (63-72, reasonLabel 'What is it waiting on?') and Close (84-92, 'Closing remarks') both go through it. page.tsx:123-132 shows the Resolution card whenever r.resolution is truthy and prints 'Resolved {fmt(r.resolvedAt)}' (fmt(undefined)='—'), so a pending request shows 'Resolved —' with a waiting note; Close overwrites a prior resolution. Whether the PATCH /status route accepts a separate note field is cannot-verify (crm-service is not in the snapshot).
- **Files to change:** `apps/web/src/app/(app)/crm/service-requests/[id]/ServiceRequestActions.tsx`, `apps/web/src/app/(app)/crm/service-requests/[id]/page.tsx`
- **Fix steps:**
  1. Confirm with crm-service whether PATCH /v1/crm/service-requests/:id/status can take a separate field (e.g. statusNote/closingRemarks) distinct from resolution; if not, add it (zod schema + audit event).
  2. In setStatus send `resolution` only for status 'resolved'; send pending reason and close remarks under the new field.
  3. In [id]/page.tsx render the Resolution card only when status is resolved/closed and resolvedAt is set; render a separate 'Waiting on' / 'Closing remarks' card from the new field.
  4. Add the new optional field to ServiceRequestDetail interface and the mapResponse.
  5. Do not display 'Resolved —': hide the timestamp line when resolvedAt is missing.
- **Acceptance:**
  - Component/render test: status=pending with waiting note shows 'Waiting on' card and no Resolution card.
  - Manual: resolve a request, then close it with remarks; Resolution text is unchanged and closing remarks appear separately.
  - Network: Mark pending payload has no `resolution` key.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Changing the API field touches audit/notification templates that may read resolution (citizen is told 'notified' on resolve); keep resolution semantics for resolve unchanged.

### GAP-CRM-SERVICE-REQUESTS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Citizen phone and email print in clear to every CRM user; contact details of citizens should be masked or reveal-on-demand with access logging under DPDP (service-requests/[id]/page.tsx:140-146).
- **Verified evidence:** [id]/page.tsx:138-140 renders r.citizenPhone and r.citizenEmail as plain text in the Citizen card, visible to every user passing the CRM layout (crm_user etc.). No masking helper or access log. No shared <Masked> exists in ds (only a local maskPhone in telephony/calls/page.tsx:37). Observation's line range 140-146 is slightly off.
- **Files to change:** `apps/web/src/app/(app)/crm/service-requests/[id]/page.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Create ds/Masked.tsx (props value, kind 'phone'|'email', canReveal, onReveal) generalising telephony maskPhone; export from ds/index.ts.
  2. Make the Citizen card mask phone/email by default (e.g. 98******10, a***@d***.in) with a Reveal button for crm_admin/allowed roles only.
  3. Reveal calls a small audited endpoint or POST /audit event 'crm.service-request.pii-revealed' (id, field, actor) before showing the value; confirm the endpoint with backend.
  4. Keep server-side enforcement: backend should return unmasked values only to roles allowed.
- **Acceptance:**
  - Component test: phone renders masked until Reveal is clicked; non-privileged role has no Reveal button.
  - Manual: click Reveal and verify an audit event is recorded.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure today; over-masking may slow desk staff who must call citizens, so role list needs a business decision.
- **Depends on:** <Masked> shared component, GAP-CRM-SERVICE-REQUESTS-02

### GAP-CRM-SERVICE-REQUESTS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The status PATCH omits the `version` the page fetched, so two officers acting at once silently overwrite each other; the Audit card shows only two timestamps, no actor or status history (ServiceRequestActions.tsx:18, [id]/page.tsx:148-152).
- **Verified evidence:** ServiceRequestDetail declares version (page.tsx:23) but ServiceRequestActions receives only id and status (page.tsx:95) and setStatus body is {status, resolution?} (Actions:37) - no version/If-Match, so last write wins (whether the service would enforce it is cannot-verify). Audit card (page.tsx:143-148) shows only Logged and Last updated timestamps, no actor or status history; the detail type has no createdBy/updatedBy/history fields to render.
- **Files to change:** `apps/web/src/app/(app)/crm/service-requests/[id]/page.tsx`, `apps/web/src/app/(app)/crm/service-requests/[id]/ServiceRequestActions.tsx`
- **Fix steps:**
  1. Pass r.version into <ServiceRequestActions> and include it in the PATCH body (or If-Match header) per what crm-service supports.
  2. On 409/conflict response show a message 'Someone else changed this request; reload' and call router.refresh().
  3. Ask backend to expose updatedBy and a status history (from audit events) on GET /service-requests/:id; render an Activity timeline in the Audit card (actor, from->to status, reason, time).
  4. Extend ServiceRequestDetail with those fields only once the API returns them.
- **Acceptance:**
  - Test: PATCH body contains the fetched version.
  - Manual: open request in two tabs, act in both; second gets a conflict message rather than overwriting.
  - Audit card lists who changed status and when.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Optimistic locking rejects stale writes - confirm the API returns 409 and that users are not blocked by benign updatedAt bumps.
- **Depends on:** GAP-CRM-SERVICE-REQUESTS-DETAIL-01

### GAP-CRM-SERVICE-REQUESTS-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** assignedTo is loaded but never shown, there is no assign/reassign action, and Due is a plain date with no overdue indicator; a "cancelled" status is treated as terminal yet no action sets it (service-requests/[id]/page.tsx:17,112, ServiceRequestActions.tsx:24).
- **Verified evidence:** assignedTo is in ServiceRequestDetail (page.tsx:17) but not rendered anywhere in the JSX; there is no assign/reassign ActionButton in ServiceRequestActions.tsx (only Start work, Mark pending, Resolve, Close). Due renders fmt(r.dueAt) (page.tsx:114) as date-time with no overdue cue or SLA state. Actions:31 treats 'cancelled' as terminal, yet no action calls setStatus('cancelled'). Observation line numbers are off by a few lines.
- **Files to change:** `apps/web/src/app/(app)/crm/service-requests/[id]/page.tsx`, `apps/web/src/app/(app)/crm/service-requests/[id]/ServiceRequestActions.tsx`, `apps/web/src/app/(app)/crm/service-requests/ServiceRequestsTable.tsx`
- **Fix steps:**
  1. Add an 'Assigned to' Field in Request Details; resolve the id to a name via the existing assignment-directory data used elsewhere in CRM (confirm the loader) and show 'Unassigned' when null.
  2. Add an Assign/Reassign action (requireReason optional) only if crm-service has an assign endpoint - otherwise leave out and note as backend gap.
  3. Show Due with an 'Overdue by Nd' StatusPill (tone bad) when dueAt < now and status not resolved/closed/cancelled.
  4. Add a 'Cancel' ActionButton (requireReason, danger) for open/pending, or remove 'cancelled' from the terminal check if the state is not supported.
- **Acceptance:**
  - Test: dueAt in the past with status open renders the Overdue indicator; resolved does not.
  - Manual: assigned officer name shows on detail.
  - Cancel action (if added) sends status=cancelled and then shows terminal text.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Assignment change is an approval-relevant action; must emit an audit event server-side.
- **Depends on:** GAP-CRM-SERVICE-REQUESTS-03

### GAP-CRM-SERVICE-REQUESTS-DETAIL-06  ·  LOW  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Reasons need only one character, and Close is offered from every non-terminal status including open, so a request can be closed without ever being worked (ds/ConfirmDialog.tsx:72, ServiceRequestActions.tsx:64).
- **Verified evidence:** ConfirmDialog.tsx:72 defaults minReasonLength = 1 and ActionButton only forwards minReasonLength when set (ActionButton.tsx:122); none of the four actions in ServiceRequestActions.tsx pass it, so one character satisfies 'Resolution', 'Closing remarks' etc. Close (Actions:84-92) renders for every non-terminal status including open. The dialogs already require a reason, so the 'add ConfirmDialog' fix text does not apply; maker!=checker is not applicable to this flow.
- **Files to change:** `apps/web/src/app/(app)/crm/service-requests/[id]/ServiceRequestActions.tsx`
- **Fix steps:**
  1. Pass minReasonLength={10} (and maxReasonLength if API limits) to Resolve, Mark pending and Close ActionButtons.
  2. Hide Close when status==='open' (require Start work or Resolve first), or keep it and offer 'Cancel' for never-worked requests (see DETAIL-05).
  3. Confirm with the business which transitions are legal, mirror the service's state machine in a shared const map used by the button list.
- **Acceptance:**
  - Test: Confirm disabled for 'ok', enabled at 10 chars.
  - Test: status open renders no Close button.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; wrong state-machine guess could block a legitimate quick-close, so confirm rules first.
- **Depends on:** GAP-CRM-SERVICE-REQUESTS-DETAIL-05


---
## /crm/service-requests/new  —  `crm/service-requests-new.html`

- **Source:** `apps/web/src/app/(app)/crm/service-requests/new/page.tsx`
- **Design reference:** `redesign/crm/service-requests-new.html`

### GAP-CRM-SERVICE-REQUESTS-NEW-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Phone and email of a citizen are collected with no DPDP purpose or consent note and neither is required, so a request can be filed with no way to reach the citizen (the feedback form, by contrast, carries a DPDP consent checkbox) (apps/web/src/app/(app)/crm/service-requests/new/page.tsx:88-100, voice-of-customer/feedback/page.tsx).
- **Verified evidence:** new/page.tsx:124-131 Phone and Email inputs have no required attribute, no DPDP purpose/notice and no consent checkbox; body sends them as undefined when blank (43-56), so a request can be filed with no contact route. The feedback form has a consent checkbox (feedback/page.tsx:227-245) but that form is itself not wired. Observation's line numbers (88-100) are off; real ones 124-131.
- **Files to change:** `apps/web/src/app/(app)/crm/service-requests/new/page.tsx`
- **Fix steps:**
  1. Add a purpose notice under Citizen Details: 'Contact details are collected only to process this request (DPDP Act 2023)', with i18n keys (English/Hindi/Odia).
  2. Require at least one of phone or email (client zod check and inline error) via a refine.
  3. Optionally add a 'Consent obtained from citizen' checkbox and send consentRecordedAt/purpose in body if the API supports it (confirm with backend; do not invent fields).
  4. Show field errors with formError.fieldError like the other fields.
- **Acceptance:**
  - Test: submit with both blank shows 'Enter phone or email'.
  - Test: notice renders and is present in the form.
  - Manual: valid submit still navigates to detail.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Making one contact mandatory may block walk-in anonymous cases; product must confirm.
- **Depends on:** GAP-CRM-SERVICE-REQUESTS-NEW-05

### GAP-CRM-SERVICE-REQUESTS-NEW-02  ·  MEDIUM  ·  partly  ·  theme WIRING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Service types are a 10-item constant inside the page, not an admin taxonomy, although the list route's own comment says a service request has "its own service-type taxonomy"; new services need a code change and "Other" is a dead-end (service-requests/new/page.tsx:8-19, service-requests/page.tsx:34).
- **Verified evidence:** SERVICE_TYPES is a 10-entry constant (new/page.tsx:14-25); the list page comment (service-requests/page.tsx:30-32) says the register has its own service-type taxonomy. True that adding a type needs a code change. 'Other' is not a dead-end: it is a selectable value and Subject/Description capture detail, though the list has no way to filter by it meaningfully. Existence of an admin taxonomy endpoint is cannot-verify (no crm-service); the theme DEADROUTE is wrong.
- **Files to change:** `apps/web/src/app/(app)/crm/service-requests/new/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm with backend whether a service-types master (or reuse of crm document-types/lead-reason-codes style admin master) exists; if so add a loader getCrmServiceTypes().
  2. Replace the constant with options from that loader, keeping the constant only as fallback labelled clearly.
  3. Optionally add an admin master page under /crm (mirroring lead-reason-codes) to manage types.
  4. Stop sending free-text label as serviceType; send a code + label if the API supports it.
- **Acceptance:**
  - Test: new service type added in admin appears in the select without redeploy.
  - Test: loader failure shows fallback list with no crash.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Existing records store label strings; migrating to codes needs mapping.

### GAP-CRM-SERVICE-REQUESTS-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme DATAMODEL (was VALIDATION)

- [~] **Status** NEEDS OWNER DECISION — requires backend contactId/duplicate-check endpoint; no owner decision yet
- **W0-10 note:** review found the W0 tick partly — Contact link done (new/page.tsx:18-26,198,325-341) but no open-request/phone/email duplicate check or 'Possible duplicate: SR-xxx' warning; only a static possibleContactNote (:346); no test for duplicate warning
- **First-pass claim:** The request is not linked to an existing CRM contact or account and there is no duplicate check, so the same citizen filing twice creates two unrelated records (service-requests/new/page.tsx:26-34).
- **Verified evidence:** The POST body (new/page.tsx:48-56) has only citizenName, citizenPhone, citizenEmail, serviceType, subject, description, priority: no contactId/accountId and no lookup or duplicate check before submit. The list loader row type also has no contact link. Whether the service dedups is cannot-verify. Theme VALIDATION is loose; this is a data-linking gap.
- **Files to change:** `apps/web/src/app/(app)/crm/service-requests/new/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add an optional contact search combobox (reuse the contacts lookup used in crm deals/new) and send contactId only if POST /service-requests accepts it (confirm; else backend change).
  2. Before submit, on phone/email blur query for existing contacts/open requests with the same phone or email and show 'Possible duplicate: SR-xxx' with a link.
  3. Block submit only on hard duplicate (same citizen, same service type, still open) after user confirms via ConfirmDialog.
- **Acceptance:**
  - Test: entering a phone matching an open request shows the duplicate warning with link.
  - Manual: selecting an existing contact links the request and the detail shows the contact.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Duplicate blocking may reject valid repeat requests; warn rather than block by default.

### GAP-CRM-SERVICE-REQUESTS-NEW-05  ·  LOW  ·  confirmed  ·  theme VALIDATION (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Phone is type=tel with maxLength 32 and no format hint or validation for a 10-digit Indian mobile (service-requests/new/page.tsx:92).
- **Verified evidence:** new/page.tsx:126 is <input type='tel' maxLength={32} placeholder='e.g. 9876543210'>: a placeholder exists but no pattern, inputMode or validation; submit has no client zod (handleSubmit at 43-56 only relies on server field errors, and there is no fieldError display for phone/email). Line 92 in the observation is wrong. The PII fix text does not apply - this is validation.
- **Files to change:** `apps/web/src/app/(app)/crm/service-requests/new/page.tsx`
- **Fix steps:**
  1. Add inputMode='tel', pattern for a 10-digit Indian mobile (optional +91) and a helper text 'Enter 10-digit mobile number'.
  2. Validate with a zod schema (phone regex /^(\+91[- ]?)?[6-9]\d{9}$/, email) before fetch and render errors via formError-style spans.
  3. Normalise to digits before sending; keep maxLength but at 15.
- **Acceptance:**
  - Test: '12345' shows error and no request is sent; '9876543210' and '+91 98765 43210' accepted.
  - Server field error for citizenPhone is displayed under the input.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Overly strict regex would reject landlines; allow STD numbers if desk needs them.
- **Depends on:** GAP-CRM-SERVICE-REQUESTS-NEW-01


---
## /crm/task-escalation  —  `crm/task-escalation.html`

- **Source:** `apps/web/src/app/(app)/crm/task-escalation/page.tsx`
- **Design reference:** `redesign/crm/task-escalation.html`

### GAP-CRM-TASK-ESCALATION-01  ·  HIGH  ·  confirmed  ·  theme VALIDATION (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Manager role and Manager user are free-text (placeholders "sales_manager", "user id (optional)"), so a mistyped role or id saves as valid and tasks escalate to nobody; the rule shows no resolved name, no preview and no dry run (apps/web/src/app/_components/crm/TaskEscalationEditor.tsx:106,150-165).
- **Verified evidence:** TaskEscalationEditor.tsx:156 (Manager role, placeholder 'e.g. sales_manager') and :160 (Manager user, placeholder 'user id (optional)') are free-text inputs; rowValid (34-36) only checks non-empty, so a mistyped role/id saves. The rule shows no resolved name, no preview and no dry run. Server-side validation is cannot-verify (crm-service absent). Theme FABRICATED is wrong: it is a validation/picker issue.
- **Files to change:** `apps/web/src/app/_components/crm/TaskEscalationEditor.tsx`, `apps/web/src/lib/crm/activityAccount.ts`
- **Fix steps:**
  1. Replace Manager role with a select fed by the tenant's role list and Manager user with a searchable user picker (reuse the assignment-directory / users lookup that other CRM editors use; confirm the loader), storing ids.
  2. Show the resolved display name next to each saved rule and flag rules whose manager no longer exists.
  3. Add a 'Preview' line: 'Tasks overdue by 24h will be escalated to <name/role>' and a count of currently matching tasks from getOverdueTasks().
  4. Keep server validation authoritative; surface its field errors.
- **Acceptance:**
  - Test: free-text unknown role cannot be chosen; picker returns id.
  - Manual: saved rule shows manager name and a preview count.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Escalation to a wrong or missing manager silently drops overdue-task accountability.
- **Depends on:** GAP-CRM-TASK-ESCALATION-05

### GAP-CRM-TASK-ESCALATION-02  ·  HIGH  ·  partly  ·  theme IDLEAK (was FAILMASK)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The Owner column can print a raw owner id (uuid) because the loader falls back owner → actorName → ownerId, and the overdue list has no limit or paging (apps/web/src/lib/crm/activityAccount.ts:282, OverdueTaskAlerts.tsx:80).
- **Verified evidence:** activityAccount.ts:284 sets owner from r.owner ?? r.actorName ?? r.ownerId, so an opaque id is printed if the API sends no name; OverdueTaskAlerts.tsx:86 renders t.owner directly. getOverdueTasks (activityAccount.ts ~getOverdueTasks) calls v1/crm/activities?type=task&status=open&overdue=true with no limit/page, and the table renders all rows with no paging. Error handling is actually correct (isError shows '—' and badge), so theme FAILMASK is wrong. Line refs in the observation (282, 80) are off.
- **Files to change:** `apps/web/src/lib/crm/activityAccount.ts`, `apps/web/src/app/_components/crm/OverdueTaskAlerts.tsx`
- **Fix steps:**
  1. In normaliseOverdueTasks keep ownerId separate from owner; expose ownerName only from owner/actorName, and set owner undefined when only an id exists.
  2. Resolve ownerId to a display name via the users/assignment directory loader, else show 'Assigned (name unavailable)'.
  3. Add limit/page to the request (confirm the API supports them) and a Pager, or cap at 50 with 'Showing 50 of N' using meta.total.
  4. Keep the existing worst-aged sort server-side if possible.
- **Acceptance:**
  - Unit test: item with only ownerId yields no raw uuid in rendered Owner cell.
  - Test: 200 overdue tasks render 50 per page.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; only display and request params.
- **Depends on:** GAP-CRM-TASK-ESCALATION-06

### GAP-CRM-TASK-ESCALATION-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The route is admin-only as a whole, so the managers who receive escalations cannot open the overdue list unless they hold crm_admin; monitoring and configuration are bundled on one page (task-escalation/layout.tsx:8, page.tsx:17).
- **Verified evidence:** task-escalation/layout.tsx:11-14 allows only crm_admin, admin, super_admin, platform_admin, tenant_admin (requireAnyRole with redirect to /crm); page.tsx:31-34 puts OverdueTaskAlerts and TaskEscalationEditor on that single admin-gated route, so a crm_user manager cannot see the overdue list. Whether escalation-target managers hold crm_admin is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/crm/task-escalation/layout.tsx`, `apps/web/src/app/(app)/crm/task-escalation/page.tsx`, `apps/web/src/app/(app)/crm/overdue-tasks/page.tsx (new, name to decide)`
- **Fix steps:**
  1. Decide whether managers should see overdue tasks (product decision).
  2. Move layout guard from task-escalation/layout.tsx to the editor only: keep editor admin-only, and place <OverdueTaskAlerts/> on a route under CRM_ROLES (e.g. /crm/overdue-tasks) or in the CRM dashboard.
  3. In page.tsx conditionally render the editor by role (server-side check with the same requireAnyRole helper variant) and keep server API enforcement.
  4. Add nav entry for the new route (navRouteManifest.ts).
- **Acceptance:**
  - Test: crm_user can open overdue list, cannot open rule editor (redirected).
  - Manual: crm_admin still sees both.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Widening visibility exposes task/owner data to more users; scope by team on the API.
- **Depends on:** GAP-CRM-TASK-ESCALATION-04

### GAP-CRM-TASK-ESCALATION-04  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The task link routes to /crm/contacts/:id for every subject type except account, so a task attached to a deal or lead opens the wrong record (OverdueTaskAlerts.tsx:22).
- **Verified evidence:** OverdueTaskAlerts.tsx:21-24 subjectHref returns /crm/accounts/:id for 'account' and /crm/contacts/:id for everything else. SUBJECT_TYPES in activityAccount.ts:58 is contact, account, lead, deal, so lead and deal tasks link to a contact route with a wrong id. /crm/deals/[id] exists; no /crm/leads/[id] page was found in the app, so lead needs a decision.
- **Files to change:** `apps/web/src/app/_components/crm/OverdueTaskAlerts.tsx`
- **Fix steps:**
  1. Extend subjectHref: contact -> /crm/contacts/:id, account -> /crm/accounts/:id, deal -> /crm/deals/:id, lead -> the lead detail route if one exists (else render plain text).
  2. Keep literal path prefixes (comment references crm-link-integrity check).
  3. Return null for unknown types and render the subject without a link.
- **Acceptance:**
  - Unit test subjectHref for all four types.
  - Manual: click a deal task -> deal page opens.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CRM-TASK-ESCALATION-05  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Threshold is entered in raw minutes (default 1440) with no unit hint or conversion, and rules have no order, level or cascade, so two enabled rules at the same threshold have undefined behaviour in the UI (TaskEscalationEditor.tsx:66,145).
- **Verified evidence:** TaskEscalationEditor.tsx:71 defaults thresholdMinutes to 1440 and the input (142-152) is labelled 'Overdue by (minutes)' with number input, so the unit is stated in the label - 'no unit hint' is overstated - but there is no hours/days conversion or readable echo. Rules carry only thresholdMinutes/managerRole/managerId/enabled (rule object 81-87): no order, level or cascade fields; duplicate thresholds are not rejected in the UI. Backend behaviour for ties is cannot-verify.
- **Files to change:** `apps/web/src/app/_components/crm/TaskEscalationEditor.tsx`
- **Fix steps:**
  1. Add a unit selector (minutes/hours/days) that converts to thresholdMinutes and echoes '= 1 day' under the field.
  2. Validate on save that no two enabled rules share the same threshold + manager; show inline error.
  3. Sort rules by threshold ascending in the list and label them 'Level 1, 2...' if backend supports cascading; otherwise document that each rule fires independently.
  4. Add a max (e.g. 525600) to the input.
- **Acceptance:**
  - Test: entering 2 days stores 2880.
  - Test: duplicate enabled rule blocked with message.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Changing units must not alter stored minutes for existing rules.
- **Depends on:** GAP-CRM-TASK-ESCALATION-01

### GAP-CRM-TASK-ESCALATION-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The tile and card read "Overdue tasks" / "Overdue open tasks" but there is no action (reassign, snooze, escalate now) beside a row (OverdueTaskAlerts.tsx:60).
- **Verified evidence:** OverdueTaskAlerts.tsx table (lines ~70-86) has columns Task, Due, Overdue by, Owner only; no row actions. Tile label 'Overdue tasks' (52). Whether reassign/snooze endpoints exist is cannot-verify; only the activities and rules routes are referenced in activityAccount.ts.
- **Files to change:** `apps/web/src/app/_components/crm/OverdueTaskAlerts.tsx`, `apps/web/src/lib/crm/activityAccount.ts`
- **Fix steps:**
  1. Confirm activity update endpoints (reassign owner, snooze dueAt) in crm-service.
  2. Add an Actions column with 'Reassign' (user picker) and 'Snooze' (new due date, required reason via ConfirmDialog) calling the activity update route; refresh list after.
  3. Add 'Open' link that already exists via subject; keep keyboard-accessible buttons.
- **Acceptance:**
  - Test: Reassign updates Owner and removes/keeps the row correctly.
  - Manual: audit event emitted for each action.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Mutations on tasks need audit and permission checks server-side.
- **Depends on:** GAP-CRM-TASK-ESCALATION-04


---
## /crm/voice-of-customer  —  `crm/voice-of-customer.html`

- **Source:** `apps/web/src/app/(app)/crm/voice-of-customer/page.tsx`
- **Design reference:** `redesign/crm/voice-of-customer.html`

### GAP-CRM-VOICE-OF-CUSTOMER-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The Partial-window card tells readers to "Narrow the period to read an exact figure", but the page has no period control and calls the loader with no from/to, so the advice cannot be followed and truncated figures stay approximate (apps/web/src/app/(app)/crm/voice-of-customer/page.tsx:20,72-80, _data/loaders.ts:3065).
- **Verified evidence:** apps/web/src/app/(app)/crm/voice-of-customer/page.tsx:17 calls getCrmSentimentSummary() with no args; the Partial-window Card at :73-81 says 'Narrow the period'. The loader (apps/web/src/app/_data/loaders.ts:3065-3072) already accepts range {from,to} and forwards them as query params to /api/v1/crm/sentiment/summary, but the page has no searchParams or date control, so the advice cannot be followed.
- **Files to change:** `apps/web/src/app/(app)/crm/voice-of-customer/page.tsx`, `apps/web/src/app/(app)/crm/voice-of-customer/PeriodFilter.tsx (new)`
- **Fix steps:**
  1. Make VoiceOfCitizenPage accept searchParams {from,to}; validate with a small zod schema (ISO yyyy-mm-dd, from<=to) and pass to getCrmSentimentSummary({from,to}).
  2. Create a client PeriodFilter (two date inputs or a Segmented: 7d/30d/90d/All) that writes from/to into the URL via router.replace.
  3. Render PeriodFilter in PageHeader actions or above StatGrid; show the active window in the subtitle.
  4. Keep the Partial-window Card but reword to point at the filter; only show the 'Narrow the period' sentence when the filter exists.
  5. Note the loader caches 60s (revalidateSeconds) keyed by URL so different windows do not collide.
- **Acceptance:**
  - Component test: visiting ?from=2026-09-01&to=2026-09-30 calls the loader with those values and fetches the URL with from/to.
  - Manual: with truncated=true, choosing a shorter period re-renders figures and clears/keeps the notice per API response.
  - Invalid range (from>to) shows a validation message, no fetch.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only aggregate. Backend support for from/to is assumed from the loader signature and comment but the CRM service is absent from the snapshot (cannot verify server honours it).

### GAP-CRM-VOICE-OF-CUSTOMER-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Failure reads as absence for the themes: on error the four tiles show "—" but the theme card renders the empty state "Nothing scored yet — Log an interaction", pushing staff to create data instead of retry (voice-of-customer/page.tsx:112, ThemeTable.tsx:73).
- **Verified evidence:** apps/web/src/app/(app)/crm/voice-of-customer/page.tsx:23,44-70,89-107 gates all tiles on isError and shows a DataSourceBadge, but :113 renders <ThemeTable themes={themes}/> unconditionally; on error the loader returns CRM_VOC_EMPTY (themes: [], apps/web/src/app/_data/loaders.ts:3049-3056), so ThemeTable.tsx:64-70 shows 'Nothing scored yet' with a 'Log an interaction' CTA. No RefreshErrorState is used on the page.
- **Files to change:** `apps/web/src/app/(app)/crm/voice-of-customer/page.tsx`
- **Fix steps:**
  1. In page.tsx, when isError, render <RefreshErrorState error={toHumanError('load',{area:'citizen feedback themes'})} backHref='/crm'/> inside the 'Key Feedback Themes' Card instead of <ThemeTable/> (pattern as estab/compliance/page.tsx:43-47).
  2. Optionally replace the whole StatGrid/Sentiment Mix with a single RefreshErrorState so tiles of dashes are not shown next to a retry.
  3. Keep the empty state only for source!=='error' && themes.length===0.
- **Acceptance:**
  - Component test: mock getCrmSentimentSummary -> {source:'error'}; expect a Retry button and no 'Nothing scored yet' text.
  - Mock success with themes [] -> empty state with 'Log an interaction' still shown.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CRM-VOICE-OF-CUSTOMER-03  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Tone pills carry no signal: "Needs attention", "Watch" and "Healthy" are not in StatusPill's colour map, so all three fall back to the same info blue and a 64% negative theme looks identical to a 7% one (ThemeTable.tsx:14, ds/StatusPill.tsx:4-40).
- **Verified evidence:** ThemeTable.tsx:15-19 returns 'Needs attention' / 'Watch' / 'Healthy' and :38 passes it as StatusPill status. ds/StatusPill.tsx STATUS_MAP (:5-39) has none of those keys, so :53 falls back to 'info' for every row (all render blue). Tone is also colour-only in effect (label text does differ, so not totally lost).
- **Files to change:** `apps/web/src/app/(app)/crm/voice-of-customer/ThemeTable.tsx`
- **Fix steps:**
  1. In ThemeTable, map tone to an explicit variant and label, e.g. toneOf returns {status:'failed'|'pending'|'active', label}, then <StatusPill status={t.status} label={t.label}/> (reuses existing bad/warn/good keys, avoids editing the global map).
  2. Alternatively add 'needs attention':'bad', watch:'warn', healthy:'good' to STATUS_MAP in _components/ds/StatusPill.tsx (check no other screen uses 'watch' expecting info).
  3. Add a unit test for toneOf thresholds 60/30 and the resulting pill class.
- **Acceptance:**
  - Component test: rows with negativePct 64, 35, 7 render pill classes bad, warn, good.
  - Visual: three distinct colours in light and dark mode.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; global map edit could recolour other screens using 'watch'.

### GAP-CRM-VOICE-OF-CUSTOMER-05  ·  MEDIUM  ·  partly  ·  theme ACCESS (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Staff-conduct and "Integrity concerns" themes are visible, with counts and CSV export, to every CRM user; the only protection is a paragraph about anonymisation, with no role gate for vigilance-sensitive aggregates (voc.ts:10-11, ThemeTable.tsx:60).
- **Verified evidence:** True that the page exposes 'Staff conduct' and 'Integrity concerns' (voc.ts:7,9 THEME_LABELS in apps/web/src/app/(app)/crm/voice-of-customer/voc.ts) with counts and a CSV export (ThemeTable.tsx:61-63 exportable) and an anonymisation note (page.tsx:40-43). The only gate is the CRM layout: crm/layout.tsx requireAnyRole(['crm_user','crm_admin','platform_admin','super_admin']), so it is not 'every user' but every CRM user, with no finer role. <Masked> exists (used in admin/integrations, hr employees) but is for secrets/PII fields and is not a fit for aggregates. Whether the API itself restricts sensitive themes cannot be verified (CRM service absent). DataTable export has no audit hook.
- **Files to change:** `apps/web/src/app/(app)/crm/voice-of-customer/page.tsx`, `apps/web/src/app/(app)/crm/voice-of-customer/ThemeTable.tsx`, `apps/web/src/lib/auth/workRoles.ts (add role constant)`
- **Fix steps:**
  1. DECISION: confirm with vigilance/DPO which roles may see staff_conduct and corruption theme rows and export.
  2. In page.tsx use getSessionRoles() (lib/auth/roleGuard.ts) to compute canSeeSensitive; filter those two theme keys out (or show them as 'Restricted') for others.
  3. Pass exportable={canSeeSensitive} to DataTable, or export only non-sensitive rows.
  4. Emit an audit event on export via the API (backend endpoint required; do not use console.log) - needs backend.
  5. Enforce the same filter server-side in the sentiment summary endpoint so hiding is not client-only.
- **Acceptance:**
  - Test: as crm_user without sensitive role, the table has no 'Integrity concerns' row and no Export button.
  - As authorised role, row visible and export writes an audit event.
  - API returns 403/omitted themes for unauthorised roles.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** PII/vigilance sensitivity; hiding rows changes totals shown vs headline counts, must be labelled.

### GAP-CRM-VOICE-OF-CUSTOMER-06  ·  MEDIUM  ·  confirmed  ·  theme COPY (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Naming is split: route and loading.tsx say "Voice Of Customer", the page says "Voice of Citizen", and the mood is "Mixed" in the tile but "Neutral" in the mix card; the DPDP banner uses hard-coded blue Tailwind colours instead of tokens (voice-of-customer/loading.tsx:6, page.tsx:39,49).
- **Verified evidence:** apps/web/src/app/(app)/crm/voice-of-customer/loading.tsx:6 h1 'Voice Of Customer' and error.tsx area 'CRM Voice Of Customer' vs page.tsx:31 title 'Voice of Citizen' and ThemeTable exportFilename 'crm-voice-of-citizen-themes'. Mood label: voc.ts MOOD_LABEL.neutral='Mixed' (tile, page.tsx:51) vs 'Neutral' StatCard label at page.tsx:92. DPDP banner page.tsx:40 uses Tailwind bg-blue-50 border-blue-200 text-blue-800 instead of DS tokens (--infobg/--infobd/--info; .alert class exists in civitas-ds.css:147). Theme 'PII' is wrong.
- **Files to change:** `apps/web/src/app/(app)/crm/voice-of-customer/loading.tsx`, `apps/web/src/app/(app)/crm/voice-of-customer/error.tsx`, `apps/web/src/app/(app)/crm/voice-of-customer/page.tsx`, `apps/web/src/app/(app)/crm/voice-of-customer/voc.ts`
- **Fix steps:**
  1. Pick one name (product uses 'Voice of Citizen' in page/export; align nav label too) and update loading.tsx h1 and error.tsx area.
  2. Use one polarity word: change the mix card 'Neutral' label to 'Mixed' or MOOD_LABEL.neutral to 'Neutral'.
  3. Replace Tailwind blue classes on the banner with a token-styled element (e.g. className 'alert' plus var(--infobg) inline or a new .alert.info in civitas-ds.css).
- **Acceptance:**
  - Grep shows a single spelling across loading/error/page/nav.
  - Banner renders with token colours and correct dark-mode contrast.
  - Snapshot test of labels.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /crm/voice-of-customer/feedback  —  `crm/voice-of-customer-feedback.html`

- **Source:** `apps/web/src/app/(app)/crm/voice-of-customer/feedback/page.tsx`
- **Design reference:** `redesign/crm/voice-of-customer-feedback.html`

### GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-01  ·  HIGH  ·  partly  ·  theme FABRICATED (was PII)

- [~] **Status** NEEDS OWNER DECISION — requires backend decision (build ingestion endpoint or remove route); interim: consent checkbox disabled
- **First-pass claim:** The form is a non-functional preview: handleSubmit only calls preventDefault, the submit button is permanently disabled, and no endpoint is referenced, so nothing a respondent enters is ever stored; the page is shipped as a route with a live-looking DPDP consent (apps/web/src/app/(app)/crm/voice-of-customer/feedback/page.tsx:65,205).
- **Verified evidence:** feedback/page.tsx:101-103 handleSubmit only preventDefault, submit Button is disabled (259-265), and no endpoint is referenced - all true, and the file header (3-22) documents it. But the page shows an explicit amber notice (122-144) that nothing is saved and asks users not to report real issues, so 'live-looking' is overstated; the DPDP consent checkbox (227-245) is required but meaningless. Line refs 65/205 are off.
- **Files to change:** `apps/web/src/app/(app)/crm/voice-of-customer/feedback/page.tsx`
- **Fix steps:**
  1. Decide: build the ingestion backend (endpoint, zod, storage, audit, DPDP consent record) or remove the route from the build.
  2. Until then remove the required consent checkbox or grey it so that no consent is implied; keep the notice.
  3. When built: POST via /api/proxy, use useFormError like service-requests/new, and store consent timestamp + purpose id.
- **Acceptance:**
  - Manual: form never appears to accept input silently.
  - After wiring: submitted feedback is retrievable and an audit event exists.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Collecting consent for data that is discarded is a DPDP-notice risk.
- **Depends on:** GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-02

### GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-02  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [~] **Status** NEEDS OWNER DECISION — blocked by FEEDBACK-01 backend decision; audience (staff vs citizen) not yet decided
- **First-pass claim:** A citizen-facing form lives under the staff-only CRM layout (requireAnyRole CRM_ROLES), so an actual citizen can never open it, and nothing on the Voice of Citizen page links to it (crm/layout.tsx:5, voice-of-customer/page.tsx).
- **Verified evidence:** The route sits under crm/layout.tsx:5-9 which calls requireAnyRole(CRM_ROLES) (crm_user, crm_admin, platform_admin, super_admin), so an unauthenticated or citizen-role user cannot open it. Grep finds no href to /crm/voice-of-customer/feedback outside its own page (voice-of-customer/page.tsx has only an All Interactions link, line 35).
- **Files to change:** `apps/web/src/app/(app)/crm/voice-of-customer/feedback/page.tsx`, `apps/web/src/app/(app)/crm/voice-of-customer/page.tsx`, `apps/web/src/app/(app)/citizen/feedback (existing sibling stub; confirm path)`
- **Fix steps:**
  1. Decide the audience: staff-entered feedback (keep under CRM, add link on the VoC page) or citizen self-service (move to the citizen portal route, e.g. the existing /citizen/feedback stub referenced in the file header, with its own layout).
  2. If staff-entered, add a 'Log feedback' button in voice-of-customer/page.tsx actions.
  3. If citizen-facing, mark public in policy-service and remove from CRM route tree.
- **Acceptance:**
  - Manual: intended audience can reach the form; others get redirected.
  - Link check passes (crm-link-integrity).
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Making a public route touches policy-service and abuse controls (rate limit, captcha).
- **Depends on:** GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-01

### GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-03  ·  HIGH  ·  partly  ·  theme PII

- [~] **Status** NEEDS OWNER DECISION — blocked by FEEDBACK-01 backend decision; DPDP notice wording needs legal sign-off
- **First-pass claim:** "Registered Citizen" is offered but no name, contact or identifier field appears, and the subtitle promises "confidential" while the consent text promises no third-party sharing; there is no consent record, purpose id or Odia/Hindi wording for the DPDP notice (feedback/page.tsx:145-195).
- **Verified evidence:** Radio 'Registered Citizen' (feedback/page.tsx:187-190) is offered but no name/contact/identifier input follows; subtitle says 'Your response is confidential' (109) while consent text (234-238) says data is not shared with third parties without further consent; consent is English-only, one checkbox, no consent id/purpose id. All true, but since submission is disabled (see -01) nothing is actually collected, so severity high is overstated. Hindi/Odia wording absent - true, no i18n keys used.
- **Files to change:** `apps/web/src/app/(app)/crm/voice-of-customer/feedback/page.tsx`
- **Fix steps:**
  1. When the backend is built: show conditional identifier fields for 'registered' (citizen id or mobile) with validation.
  2. Replace the consent checkbox with a notice component: purpose, retention, rights, grievance officer, in English/Hindi/Odia via next-intl keys, and store consent version.
  3. Align subtitle with consent wording ('anonymous' vs 'confidential').
- **Acceptance:**
  - Test: choosing Registered reveals required identifier field.
  - Consent text renders in the selected locale.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP notice content needs legal sign-off.
- **Depends on:** GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-01

### GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-04  ·  MEDIUM  ·  partly  ·  theme A11Y (was NAVUX)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The rating is marked required but the star group has no required semantics, unselected and selected stars are the same glyph told apart only by colour, and each star is a separate tab stop with no arrow-key radio behaviour (feedback/page.tsx:20-60).
- **Verified evidence:** StarRating (feedback/page.tsx:45-88) uses role=radiogroup/role=radio with aria-checked and aria-label, which is decent; but the group has no aria-required, the '*' is aria-hidden (154), all five buttons are separate tab stops with no roving tabindex/arrow-key handling, and selected vs unselected stars are the same glyph differing by colour (79) - the visible 'Poor/Fair...' label at 160 partly compensates. Also the rating is not enforced: no validation that rating>0 (submission disabled anyway).
- **Files to change:** `apps/web/src/app/(app)/crm/voice-of-customer/feedback/page.tsx`
- **Fix steps:**
  1. Add aria-required=true to the radiogroup and a visually hidden 'required' text; add aria-describedby to the rating label.
  2. Implement roving tabindex (only the checked, or first, star tabbable) with ArrowLeft/Right/Up/Down and Home/End handlers.
  3. Use filled (★) vs outline (☆) glyphs for selected vs unselected.
  4. Validate rating>0 on submit with an error message.
- **Acceptance:**
  - Test: Tab enters group once; ArrowRight moves selection.
  - Axe: no radiogroup violations; selected state visible in forced-colors mode.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Feedback is not tied to a service, request or interaction, and the Voice of Citizen dashboard scores logged interactions only, so even a wired form would not reach the dashboard it is named after (feedback/page.tsx, voice-of-customer/page.tsx:20).
- **Verified evidence:** The form has no serviceId/requestId/interactionId field (feedback/page.tsx fields: rating, comment, contactType, dpdpConsent). voice-of-customer/page.tsx:20 reads getCrmSentimentSummary, and the file header (10-17) states the sentiment pipeline is populated only by scoring logged CRM interactions with no write route for self-report. So feedback would not reach the dashboard.
- **Files to change:** `apps/web/src/app/(app)/crm/voice-of-customer/feedback/page.tsx`, `apps/web/src/app/(app)/crm/voice-of-customer/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Product decision: should citizen ratings feed the VoC dashboard? If yes, define backend model: feedback linked to serviceRequestId/interactionId, with rating and sentiment.
  2. Add optional 'Regarding' selector (service request reference) to the form once the model exists.
  3. Extend getCrmSentimentSummary consumer to show a 'Citizen ratings' tile (average, count) separate from sentiment scores.
- **Acceptance:**
  - Manual: submitted rating for SR-123 appears in the dashboard's citizen-rating tile.
  - Test: dashboard shows '—' when ratings unavailable.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** New data source changes what the dashboard means; keep sentiment and ratings separate.
- **Depends on:** GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-01

### GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-06  ·  LOW  ·  confirmed  ·  theme COPY (was LOADING)

- [x] **Status** (W0 2026-10-13 closed by #1860, verified on main 9c5e9e9e9; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** Titles diverge: "Citizen Feedback" / back label "Voice of Citizen", while the route and sibling loading.tsx say "Voice Of Customer" (feedback/page.tsx:85, voice-of-customer/loading.tsx:6).
- **Verified evidence:** feedback/page.tsx:108 title 'Citizen Feedback' and back label 'Voice of Citizen' (111); voice-of-customer/page.tsx title is 'Voice of Citizen'; voice-of-customer/loading.tsx:6 says 'Voice Of Customer' and the URL segment is voice-of-customer. Copy inconsistency only; also the loading heading is hard-coded with odd capitalisation.
- **Files to change:** `apps/web/src/app/(app)/crm/voice-of-customer/loading.tsx`, `apps/web/src/app/(app)/crm/voice-of-customer/error.tsx`, `apps/web/src/app/(app)/crm/voice-of-customer/feedback/page.tsx`
- **Fix steps:**
  1. Pick one name (recommend 'Voice of Citizen' matching the page) and set it in loading.tsx h1, nav manifest and breadcrumbs.
  2. Check navRouteManifest.ts for the label and align.
  3. Keep the URL as is to avoid breaking links.
- **Acceptance:**
  - Manual: loading, page, feedback back link and nav all say 'Voice of Citizen'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## Backend verification items (service code absent from snapshot)

### GAP-CRM-ACCOUNTS-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Merge duplicate accounts is a destructive-looking control placed between header and stats for all roles; the dialog (MergeDialog.tsx) was not read, so confirmation and audit of the merge are undeterminable (app/(app)/crm/accounts/page.tsx:44).
- **Service:** `crm-service`  ·  **Endpoint(s):** `['PATCH /v1/crm/accounts/:id/parent', '(merge) MergeDialog uses client lib/crm/dataQuality mergeEntities']`
- **Question:** Is account merge performed server-side with role gate, confirmation-worthy irreversibility handling and audit, rather than client only?
- **How to verify:** Read MergeDialog.tsx and dataQuality.mergeEntities; then search crm-service for a merge route.
- **Test to add:** Given two duplicate accounts, when merge, then children/contacts re-parented, source tombstoned, audit row with actor.
- **Impact if wrong:** Irreversible data loss without trail; high.
- **Web change if wrong:** Add confirm step and role gate; call a server merge endpoint.

### GAP-CRM-ASSIGNMENT-DIRECTORY-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Deleting a queue, territory, partner or branch says only "no longer available for assignment"; nothing warns when an assignment rule or lead still references it, and the response to that case is undeterminable without the backend (app/_components/crm/OwnershipDirectoryEditor.tsx:200).
- **Service:** `crm-service`  ·  **Endpoint(s):** `['DELETE /v1/crm/{assignment-queues|territories|partners|branches}/:id', 'GET /v1/crm/assignment-rules']`
- **Question:** Does DELETE of a referenced queue/territory/partner/branch return 409 or cascade, instead of leaving dangling rule/lead references?
- **How to verify:** DELETE a queue referenced by an assignment rule and by a lead.
- **Test to add:** Given queue used by a rule, when DELETE, then 409 IN_USE listing references.
- **Impact if wrong:** Orphaned leads never assigned; medium.
- **Web change if wrong:** Surface 409 and counts in OwnershipDirectoryEditor.tsx:200.

### GAP-CRM-DEALS-DETAIL-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 2026-10-16: verified in crm-service, W2 crm: closed by #close-routes.ts has requireRole(CLOSE_ROLES) and 400 on missing reason; web shows 403/400 via error toast)
- **First-pass claim:** Mark Won and Mark Lost are rendered for every CRM role although closing is a governed mutation; a role that the close endpoint rejects will only discover it after confirming (DealDetailActions.tsx:82-113). Backend rule undeterminable (crm-service absent).
- **Service:** `crm-service`  ·  **Endpoint(s):** `['POST /v1/crm/deals/:id/close']`
- **Question:** Which roles may close deals and does close require outcome and reason, returning 403 otherwise?
- **How to verify:** Open close route guard; curl as read-only sales rep.
- **Test to add:** Given rep without close permission, when POST close, then 403; without reason, 400.
- **Impact if wrong:** Unauthorised revenue recognition; medium.
- **Web change if wrong:** Hide Mark Won/Lost in DealDetailActions.tsx by role.

### GAP-CRM-DOCUMENT-TYPES-01  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** The Code of an existing type is freely editable and saved with PUT; changing the code of a type already attached to documents may orphan them, and there is no warning (DocumentTypesEditor.tsx:399, 329-333). Backend behaviour undeterminable.
- **Service:** `crm-service`  ·  **Endpoint(s):** `['PUT /v1/crm/document-types/:id', 'POST /v1/crm/document-types']`
- **Question:** Is code immutable once documents reference the type (409 or ignored) so documents are not orphaned?
- **How to verify:** PUT changed code on a type with attached documents.
- **Test to add:** Given type with 3 documents, when PUT new code, then 409 CODE_IMMUTABLE or documents keep working via id.
- **Impact if wrong:** Orphaned documents and broken checklist; medium.
- **Web change if wrong:** Make Code read-only for saved types in DocumentTypesEditor.tsx:399.

### GAP-CRM-DOCUMENTS-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** Copy asserts behaviour ('Infected files are quarantined automatically', '30 days') that is not verifiable from this route; the rules live in crm-service (absent from the snapshot), so the claim is undeterminable here (page.tsx:28-29).
- **Service:** `crm-service`  ·  **Endpoint(s):** `['POST /v1/crm/documents/presign', 'POST /v1/crm/documents', 'GET /v1/crm/documents/:id/download']`
- **Question:** Does the service quarantine infected files automatically and apply a 30-day rule as the copy states?
- **How to verify:** Open documents virus-scan consumer and retention job; upload EICAR test file.
- **Test to add:** Given EICAR upload, when scan completes, then status=quarantined and download is 403; 30-day rule verified by config test.
- **Impact if wrong:** False security claim in UI; medium.
- **Web change if wrong:** Reword page.tsx:28-29 to match behaviour.

### GAP-CRM-LINKED-ACCOUNTS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Connecting' only POSTs a provider and a typed email address with status 'pending'; there is no OAuth / consent or proof of mailbox ownership, so any CRM user can register someone else's mailbox or calendar, and mailbox metadata later syncs into CRM under DPDP consent rules. The owner check would have to be server-side (crm-service absent, undeterminable) (LinkedAccountsPanel.tsx:72, 118-128; lib/crm/activityAccount.ts:919-925).
- **Service:** `crm-service`  ·  **Endpoint(s):** `['POST /v1/crm/linked-accounts', 'DELETE /v1/crm/linked-accounts/:id']`
- **Question:** Does the server verify mailbox ownership via OAuth/consent before activating a linked account, tying it to the caller only?
- **How to verify:** POST provider+email for a mailbox not owned by the caller; inspect status and sync eligibility.
- **Test to add:** Given caller A registers B's email, when POST, then stays pending and never syncs without OAuth consent; consent recorded.
- **Impact if wrong:** Mailbox metadata of others ingested; DPDP breach; high.
- **Web change if wrong:** Replace typed-email connect with OAuth flow.

### GAP-CRM-OPPORTUNITIES-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** The stage dropdown on every card lists every stage including terminal ones, so a card can be moved to Won or Lost through a plain stage change that skips the OP-006 Close dialog (outcome, reason, competitor); whether the server refuses is undeterminable because crm-service is absent (apps/web/src/app/_components/crm/OpportunityViews.tsx:225).
- **Service:** `crm-service`  ·  **Endpoint(s):** `['PATCH /v1/crm/deals/:id/stage', 'POST /v1/crm/deals/:id/close']`
- **Question:** Does the stage endpoint reject terminal stages (Won/Lost) so closing must go through /close with outcome and reason?
- **How to verify:** PATCH stage to a won-type stage.
- **Test to add:** Given open deal, when PATCH stage to Won, then 422 USE_CLOSE_ENDPOINT.
- **Impact if wrong:** Deals closed without reason/competitor; corrupts win-loss analytics; high.
- **Web change if wrong:** Filter terminal stages from the dropdown in OpportunityViews.tsx:225 and open the Close dialog.

### GAP-CRM-PIPELINES-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** Deleting a pipeline (and ✕ removing a stage of a saved pipeline) is confirmed with generic text only; the UI never shows how many opportunities sit in it, and removing a stage in the editor just drops it locally, so deals in that stage may be orphaned on save; server behaviour is undeterminable (apps/web/src/app/_components/crm/PipelineEditor.tsx:337,264).
- **Service:** `crm-service`  ·  **Endpoint(s):** `['DELETE /v1/crm/pipelines/:id', 'PUT /v1/crm/pipelines/:id']`
- **Question:** Does delete or stage removal return 409 when deals reference the pipeline/stage instead of orphaning them?
- **How to verify:** DELETE a pipeline with open deals; PUT removing a populated stage.
- **Test to add:** Given pipeline with 5 deals, when DELETE, then 409 with count; PUT dropping populated stage gives 409.
- **Impact if wrong:** Orphaned deals vanish from boards; high.
- **Web change if wrong:** Show deal counts in confirm text; handle 409.

### GAP-CRM-PRICE-BOOKS-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Two enabled books may carry identical criteria and the UI gives no warning or precedence; which one wins in Resolve is undeterminable because crm-service is absent (PriceBookEditor.tsx:104, lib/crm/quotation.ts:243).
- **Service:** `crm-service`  ·  **Endpoint(s):** `['GET /v1/crm/price-books/resolve', 'POST/PUT /v1/crm/price-books']`
- **Question:** Is there a deterministic precedence, or a uniqueness check, when two enabled books share identical criteria?
- **How to verify:** Create two identical enabled books; call resolve.
- **Test to add:** Given two books with identical criteria, when resolve, then documented deterministic winner (priority then newest) or save rejects with 409.
- **Impact if wrong:** Non-deterministic quote prices; medium.
- **Web change if wrong:** Add priority field/warning in PriceBookEditor.tsx.

### GAP-CRM-QUALIFICATION-FRAMEWORKS-02  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** A framework is saved as one document including all questions with no version or conflict check; two admins editing at once overwrite each other, and questions removed from a saved framework may orphan answers already recorded on leads (undeterminable, service absent) (QualificationFrameworksEditor.tsx:110-125).
- **Service:** `crm-service`  ·  **Endpoint(s):** `['PATCH /v1/crm/qualification-frameworks/:id', 'POST /v1/crm/qualification-frameworks', 'POST /v1/crm/leads/:id/qualify']`
- **Question:** Does PATCH qualification-frameworks/:id require and check the row `version` (409 on stale) and does it reject or soft-retire removed question ids that leads already answered?
- **How to verify:** In crm-service open the qualification-frameworks route/handler; confirm zod body carries version and repo update uses WHERE version=:v. Then PATCH twice with the same version and expect 409 on the second; PATCH removing a question id that has a lead answer and expect 409/soft-retire, not silent delete.
- **Test to add:** Given framework v1 with question Q1 answered on lead L1, when PATCH removes Q1 then Q1 is retained as retired (or 409) and L1's answer still resolves; when two PATCHes send version 1 the second returns 409.
- **Impact if wrong:** Silent lost update of a shared framework and orphaned lead qualification answers, corrupting lead scores.
- **Web change if wrong:** Send version from GET in the save payload (lib/crm/leadQualification.ts:162-170), handle 409 with a reload prompt in QualificationFrameworksEditor.tsx, and warn before removing an in-use question.

### GAP-CRM-QUALIFICATION-FRAMEWORKS-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1860, verified on main 9c5e9e9e9)
- **First-pass claim:** The delete dialog promises "This is recorded in the audit trail" but nothing on the page shows an audit entry, and audit is undeterminable from this snapshot (QualificationFrameworksEditor.tsx:281).
- **Service:** `crm-service`  ·  **Endpoint(s):** `['DELETE /v1/crm/qualification-frameworks/:id']`
- **Question:** Does the DELETE handler emit an audit event via @civitasone/events with actor, tenant and framework id (CLAUDE.md rule 8)?
- **How to verify:** Open the delete handler in crm-service and confirm an audit emit call; run DELETE with role X and check the audit stream/table for a matching event.
- **Test to add:** Given an existing framework, when an authorised user DELETEs it then exactly one audit event (action=delete, entityId, actor) is published and the framework is no longer listed.
- **Impact if wrong:** Copy promises an audit trail that may not exist; compliance/audit-log gap.
- **Web change if wrong:** If no audit is emitted, change the dialog copy at QualificationFrameworksEditor.tsx:281 until the service is fixed.

### GAP-CRM-QUOTATIONS-05  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 2026-10-16: verified in crm-service, W2 crm: closed by #quotations-routes.ts enforces discountPct <= maxDiscountBps/100 at line 380-396; returns 422 on excess)
- **First-pass claim:** Unit price and tax % on each line are freely editable after the product picks its price-book price, so a discount can be given by typing a lower price without any approval request; whether the server catches this is undeterminable (QuotationBuilder.tsx:355-370).
- **Service:** `crm-service`  ·  **Endpoint(s):** `['POST /v1/crm/quotations', 'POST /v1/crm/quotations/:id/new-version', 'GET /v1/crm/price-books']`
- **Question:** Does POST/new-version compare each line unitPrice/discount to the price-book price and require an approval (or reject) when it is below the allowed discount threshold?
- **How to verify:** Open the quotations create handler in crm-service; look for a discount-limit/approval check. curl POST /v1/crm/quotations with a line unitPrice below price-book price as a sales role and expect 422 or a pending-approval status.
- **Test to add:** Given price-book price 1000 and max discount 10%, when a line is posted at 500 by a sales user then the API returns 422/approval_required and no sent quotation is created.
- **Impact if wrong:** Unauthorised discounting and revenue leakage with no approval trail.
- **Web change if wrong:** If not enforced: show list price vs entered price and discount % in QuotationBuilder.tsx:355-370, and block Send until approval when discount exceeds the limit.

### GAP-CRM-RTI-NEW-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1858, verified on main 9c5e9e9e9)
- **First-pass claim:** There is no received-date or mode-of-receipt field, so an RTI physically received days ago is registered with the clock starting whenever the form is filed (server default undeterminable); the 30-day statutory deadline is the register's core purpose (rti/new/page.tsx:105-260).
- **Service:** `crm-service`  ·  **Endpoint(s):** `['POST /v1/crm/rti']`
- **Question:** Does POST /v1/crm/rti accept a receivedDate (and mode) and compute the 30-day dueDate from it, defaulting to server now only when omitted?
- **How to verify:** Open the rti create zod schema and handler in crm-service; POST with receivedDate 5 days ago and check dueDate = receivedDate + 30d.
- **Test to add:** Given receivedDate=today-5 when RTI is created then dueDate=today+25 and receivedDate is persisted and audited; a future receivedDate returns 422.
- **Impact if wrong:** Statutory RTI deadlines computed from the wrong start date; missed deadlines and penalties.
- **Web change if wrong:** Add received-date and mode-of-receipt fields to crm/rti/new/page.tsx:105-260 and send them in the POST body (page.tsx:48).

### GAP-CRM-SERVICE-REQUESTS-DETAIL-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 2026-10-16: verified in crm-service, W2 crm: closed by #notify-consumer.ts emits notification event on status=resolved; failure logged and response includes notified:false)
- **First-pass claim:** Resolve promises "The citizen is notified." but nothing in the route sends or confirms a notification; whether the service does is undeterminable (ServiceRequestActions.tsx:57).
- **Service:** `crm-service`  ·  **Endpoint(s):** `['PATCH /v1/crm/service-requests/:id/status']`
- **Question:** When status becomes resolved, does the service publish a notification event to the citizen (email/SMS) and is a failure surfaced?
- **How to verify:** Open the status handler in crm-service; confirm an event/notification emit on resolved. Call PATCH status=resolved and check the notification-service outbox for a message to the request's citizenEmail/phone.
- **Test to add:** Given a request with citizenPhone, when status is set to resolved then one notification event is emitted referencing the request id; with no contact none is sent and response says so.
- **Impact if wrong:** Citizen told they were notified when they were not; grievance-handling trust issue.
- **Web change if wrong:** If no notification is sent, reword ServiceRequestActions.tsx:57 to drop 'The citizen is notified'.

### GAP-CRM-SERVICE-REQUESTS-NEW-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** No due date, SLA class or intake channel (walk-in, phone, portal) is captured, and priority is freely chosen per request; the due date shown later on the detail page has no visible source here (undeterminable server default) (service-requests/new/page.tsx:120-135).
- **Service:** `crm-service`  ·  **Endpoint(s):** `['POST /v1/crm/service-requests']`
- **Question:** Does the create handler derive dueDate/SLA class from serviceType and priority server-side, and are channel/dueDate accepted in the schema?
- **How to verify:** Open the service-request create schema/handler in crm-service; POST without dueDate and inspect the response dueDate and how it is calculated.
- **Test to add:** Given serviceType with 5-day SLA, when created with priority=high then response dueDate equals created+SLA and is never null.
- **Impact if wrong:** Requests without due dates escape SLA tracking and breach reports.
- **Web change if wrong:** Add intake channel (and optional due date) fields to service-requests/new/page.tsx:120-135 if the schema supports them; else show 'due date is set by SLA' text.

### GAP-CRM-VOICE-OF-CUSTOMER-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1859, verified on main 9c5e9e9e9)
- **First-pass claim:** Average Score prints "n / 100" while Mixed/Negative thresholds are +15 and -15, implying a signed scale (a -22 would read "-22 / 100"); the actual scale is undeterminable because @civitasone/types is absent (voc.ts:25, voice-of-customer/page.tsx:105).
- **Service:** `crm-service`  ·  **Endpoint(s):** `['GET /v1/crm/sentiment/summary']`
- **Question:** Is averageScore in the sentiment summary on a 0-100 scale or a signed -100..+100 scale?
- **How to verify:** Open the sentiment summary handler/schema in crm-service (and @civitasone/types CRMVocSummary) and read the score range; call the endpoint on data with negative feedback and check the sign.
- **Test to add:** Given only negative interactions when summary is fetched then averageScore is <0 if signed (or in 0-100 and thresholds rescaled), and the schema documents the range.
- **Impact if wrong:** Executives misread sentiment; wrong 'Mixed/Negative' bucket labels.
- **Web change if wrong:** Change the '/ 100' suffix and threshold labels in voice-of-customer/page.tsx:105 and voc.ts:25 to match the real range.


---
## Cannot verify from the snapshot

### GAP-CRM-FORECAST-04 · /crm/forecast
- **First-pass claim:** In the All pipelines view rows show only stageName; if the API returns a stage per pipeline, two pipelines with a 'Proposal' stage would appear as indistinguishable rows (StageBreakdownTable.tsx:22-29, 34).
- **Why cannot-verify:** StageBreakdownTable.tsx:22-34 shows only stageName, keyed by stageId. loaders.ts:3027-3032 maps stages to {stageId,stageName,probability,weightedTotalMinor} with no pipelineId, and the crmForecastSchema/API payload for the all-pipelines case is not inspectable (crm-service absent). Whether collisions occur is hypothetical.
