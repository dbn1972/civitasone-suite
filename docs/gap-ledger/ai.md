# Detailed gap file — module `ai`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 44, BACKEND-VERIFY 1



---
## /ai  —  `ai/home.html`

- **Source:** `apps/web/src/app/(app)/ai/page.tsx`
- **Design reference:** `redesign/ai/home.html`

### GAP-AI-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** All five tiles show the identical 📁 icon: TILE_ICONS has no AI titles and tileIcon() only matches dashboard/employees/leave/payroll/procurement hrefs (LinkTiles.tsx:18-60), so the hub gives no visual cue between Chat, Guardrails and Governance.
- **Verified evidence:** LinkTiles.tsx:10-49 TILE_ICONS has no Chat/Copilot/Agents/Guardrails/Governance; tileIcon (l.53-61) falls to '📁' unless href includes dashboard/employees/leave/payroll/procurement/orders. All five ai tiles (ai/page.tsx:431-436) resolve to 📁 ('Audit' etc. keys do not match titles).
- **Files to change:** `apps/web/src/app/_components/LinkTiles.tsx`
- **Fix steps:**
  1. Add Chat, Copilot, Agents, Guardrails, Governance to TILE_ICONS.
  2. Optionally add an `icon` field to NavTile in @civitasone/types instead of title-keyed map.
- **Acceptance:**
  - /ai shows five distinct icons.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-AI-HOME-02  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Tiles are not role- or state-aware: Governance (audit trail, agent kill-switch) is offered to every user who passes the module gate (page.tsx:6-12); the kill-switch 403s for non-admins only after the click (governance/AgentKillSwitch.tsx:34-40).
- **Verified evidence:** ai/page.tsx:431-437 lists all tiles unconditionally; only the module gate applies (ai/layout.tsx). Kill-switch is inside Governance, which is also useful read-only to non-admins, so hiding the tile is not necessarily right. 403 handling is in AgentKillSwitch.tsx:131. Role model/guard not verified.
- **Files to change:** `apps/web/src/app/(app)/ai/page.tsx`, `apps/web/src/app/(app)/ai/governance/AgentKillSwitch.tsx`
- **Fix steps:**
  1. Prefer fixing at the control (see GOVERNANCE-05) rather than hiding the tile.
  2. If tile gating is desired, add a requiredRole to NavTile and filter in ai/page.tsx using the shared role helper.
- **Acceptance:**
  - Non-admin sees Governance but Pause/Resume are disabled with explanation.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Hiding features from auditors could reduce oversight.
- **Depends on:** GAP-AI-GOVERNANCE-05

### GAP-AI-HOME-03  ·  LOW  ·  confirmed  ·  theme LAYOUT (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Five tiles in a 'four' column grid leave an orphan tile on desktop (page.tsx:17).
- **Verified evidence:** ai/page.tsx:443 columns='four' -> .g-4 four-column grid (civitas-ds.css:101); 5 tiles wrap 4+1 on desktop. Not a dead route.
- **Files to change:** `apps/web/src/app/(app)/ai/page.tsx`
- **Fix steps:**
  1. Use columns='three' (3+2) or add a 6th tile / section labels.
  2. Prefer three columns.
- **Acceptance:**
  - Desktop layout shows no lone orphan.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-AI-HOME-04  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** ai/loading.tsx is Tailwind slate/white with fixed light colours (loading.tsx:4-24), out of step with the DS tokens used elsewhere and unreadable in dark mode.
- **Verified evidence:** ai/loading.tsx uses Tailwind bg-slate-50, bg-white, bg-gray-200 (l.3-24) with fixed light colours and min-h-screen; app dark mode is a `.dark` class with DS tokens (civitas-ds.css:315-331), so skeleton is light in dark mode. copilot/loading.tsx shares the pattern. Line refs are approximate.
- **Files to change:** `apps/web/src/app/(app)/ai/loading.tsx`, `apps/web/src/app/(app)/ai/copilot/loading.tsx`, `apps/web/src/app/(app)/ai/governance/loading.tsx`
- **Fix steps:**
  1. Replace with ds Skeleton (app/_components/ds/Skeleton.tsx) and DS tokens.
  2. Drop min-h-screen and outer padding duplicated by the shell.
  3. Apply to sibling loading files.
- **Acceptance:**
  - In .dark mode, loading skeleton uses dark surfaces.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** None.


---
## /ai/agents  —  `ai/agents.html`

- **Source:** `apps/web/src/app/(app)/ai/agents/page.tsx`
- **Design reference:** `redesign/ai/agents.html`

### GAP-AI-AGENTS-01  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Failed fetch reads as an empty list: loader returns [] and the table shows 'No records — Nothing to show yet' (ai/_data.ts:86-94, ModuleListTable.tsx:35); on the Agents page this looks like 'no agents defined' when the service is merely unreachable.
- **Verified evidence:** _data.ts moduleLoader (line ~85-91) returns [] with source 'error' on failure; agents/page.tsx passes source to ModuleListPage, which passes 'error' to ModuleListTable. useSeededResource (lib/sync/resource.ts:215-260) sets provenance 'error-no-data' when no cache exists, and the table renders DataSourceBadge with it, so an amber error badge does appear; however lines 34-36 of ModuleListTable still render EmptyState 'No records — Nothing to show yet for this module.' for data.length===0, contradicting the badge. Shared by 64 pages using ModuleListPage. Line refs in the observation are off (ModuleListTable EmptyState is at ~35).
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. In ModuleListTable, when provenance==='error-no-data' render <RefreshErrorState error={toHumanError('load',{area:title})} /> instead of EmptyState (pass a `title` prop from ModuleListPage).
  2. Keep EmptyState only for provenance 'live'/'cached' with zero rows; reword to per-module copy via optional emptyTitle/emptyMessage props.
  3. Verify all 64 ModuleListPage callers still type-check.
- **Acceptance:**
  - Component test: source='error', no cache -> retry state shown, no 'No records'.
  - source='api', [] -> EmptyState.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared component touches 64 screens; snapshot-test a few.
- **Depends on:** Shared: ModuleListTable

### GAP-AI-AGENTS-02  ·  MEDIUM  ·  confirmed  ·  theme UUID (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Generic five-column table for a domain list: ID is truncated to 8 chars (ModuleListTable.tsx:50) with no way to copy the full id; Detail/Meta are guessed from whichever field exists first (ai/_data.ts:50-78), so the same column may show a status word, a description or a timestamp on different rows.
- **Verified evidence:** ModuleListTable.tsx:50 renders row.id.slice(0, 8) in a span, no copy control or title/tooltip. _data.ts mapRows: sublabel (line 59+) = description ?? status ?? state ?? category ?? tier ?? programName ?? agentId ?? profileId; meta (line 69+) = code ?? currency ?? updatedAt ?? createdAt ?? points ?? balance, so columns vary per row. Headers 'ID/Name/Detail/Status/Meta' are hard-coded English (no next-intl). Note ModuleListRowSummary type is in @civitasone/types (not in snapshot). Theme is not really I18N; primarily generic-table/UUID.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/ai/_data.ts`, `apps/web/src/app/(app)/ai/agents/page.tsx`
- **Fix steps:**
  1. Add a dedicated AgentsTable for /ai/agents with fixed columns (name, status, description, updated) mapped from the agents endpoint (confirm response fields against ai-agent-service; service not in snapshot).
  2. In generic ModuleListTable, render full id in title attr and add a copy button (reuse any shared CopyButton or create <CopyId>).
  3. Replace guessed sublabel/meta fallbacks with explicit per-loader field maps, or drop the Detail/Meta columns when unavailable.
  4. Move headers to next-intl.
- **Acceptance:**
  - Component test: id cell exposes full id via title and copy button copies it.
  - Agents page shows the same field in a column for every row.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Changing the generic table affects 64 pages; scope the fixed-column change to agents first.
- **Depends on:** GAP-AI-AGENTS-01

### GAP-AI-AGENTS-03  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Raw ISO timestamps or codes are printed in Meta (e.g. 2026-09-24T09:12:40.000Z) — no date formatting in mapRows/ModuleListTable (ai/_data.ts:69-77).
- **Verified evidence:** _data.ts mapRows meta (line ~69-77) passes toText(row.updatedAt) / createdAt straight through; ModuleListTable.tsx renders {row.meta ?? '—'} with no formatting. Only reached when row.code and row.currency are absent. lib/formatters.ts has formatIndianDate (line 2) but no ISO date-time formatter was found there.
- **Files to change:** `apps/web/src/app/(app)/ai/_data.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatIndianDateTime(iso) to lib/formatters.ts (Asia/Kolkata, 'dd Mon yyyy, hh:mm').
  2. In mapRows, format updatedAt/createdAt through it before assigning meta (guard invalid dates -> keep '—').
  3. Better: split meta into a typed `updatedAt` field on the row and render a dedicated column.
- **Acceptance:**
  - Unit test: '2026-09-24T09:12:40.000Z' -> '24 Sep 2026, 02:42 pm' (IST).
  - Invalid string -> '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared _data.ts used by other AI list pages.
- **Depends on:** GAP-AI-AGENTS-02

### GAP-AI-AGENTS-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** No pause/resume here although the tile says 'Multi-agent workflows and autonomous task execution': the only control is on /ai/governance (AgentKillSwitch.tsx), and rows are not clickable.
- **Verified evidence:** AI hub ai/page.tsx:8 tile says 'Multi-agent workflows and autonomous task execution.'; agents/page.tsx is a read-only ModuleListPage (page description 'Multi-agent workflows and orchestration.'), ModuleListTable rows have no href/onClick. Pause/resume lives in ai/governance/AgentKillSwitch.tsx:25 (POST /api/proxy/v1/ai/agents/:id/pause|resume) on the governance page. Confirmed.
- **Files to change:** `apps/web/src/app/(app)/ai/agents/page.tsx`, `apps/web/src/app/(app)/ai/governance/AgentKillSwitch.tsx`
- **Fix steps:**
  1. Add a 'Manage in Governance' action (Link to /ai/governance) in PageHeader actions on agents page as the minimum.
  2. Optionally reuse <AgentKillSwitch agents={...}> on the agents page behind the same role check, with ConfirmDialog (see AI-CHAT-DETAIL-01 pattern).
  3. Align tile/page description copy with what the page really does.
- **Acceptance:**
  - Agents page has a visible link to governance; keyboard reachable.
  - If embedded: pause action calls the same endpoint and refreshes.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Kill-switch exposure needs role-gating decision.
- **Depends on:** GAP-AI-AGENTS-01

### GAP-AI-AGENTS-05  ·  LOW  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Back navigation is a plain <a href="/ai"> (full page load) with a lucide icon, not PageHeader back/Link (page.tsx:11-13).
- **Verified evidence:** agents/page.tsx:10-12: <nav className='back'><ArrowLeft/> <a href='/ai'>AI & Copilot</a></nav> — plain anchor (full reload) with lucide icon, plus a separate PageHeader inside ModuleListPage without back. PageHeader supports back/backLabel props (ds/PageHeader.tsx:16-17) but ModuleListPage does not forward them.
- **Files to change:** `apps/web/src/app/(app)/ai/agents/page.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Add optional back/backLabel props to ModuleListPage and forward to PageHeader.
  2. In agents/page.tsx remove the manual <nav> and lucide import; pass back='/ai' backLabel='AI & Copilot'.
  3. Check the same pattern in ai/guardrails/page.tsx.
- **Acceptance:**
  - Click back: client-side navigation, no full reload.
  - Only one back affordance on page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /ai/chat  —  `ai/chat.html`

- **Source:** `apps/web/src/app/(app)/ai/chat/page.tsx`
- **Design reference:** `redesign/ai/chat.html`

### GAP-AI-CHAT-01  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Failed fetch reads as good news: getChatConversations falls back to [] so stats show 0 and the table 'No conversations yet' (page.tsx:30-38, ConversationsTable.tsx:59-62); only a small badge signals the error.
- **Verified evidence:** getChatConversations (loaders.ts:2916-2923) returns [] with source 'error'. chat/page.tsx:30-38 computes summary from [] (stats 0) and only renders <DataSourceBadge> when source==='error'; ConversationsTable then shows DataTable empty 'No conversations yet'. So 'only a small badge' is accurate; the badge is not absent. Stats 0 and the empty state contradict the error.
- **Files to change:** `apps/web/src/app/(app)/ai/chat/page.tsx`, `apps/web/src/app/(app)/ai/chat/ConversationsTable.tsx`
- **Fix steps:**
  1. In page.tsx, if source==='error' render <RefreshErrorState error={toHumanError('load',{area:'conversations'})} /> in place of the Card/Table.
  2. Pass '—' to the four StatCards when errored (not summary counts).
  3. Keep StatusFilter visible so operators can retry with another filter.
- **Acceptance:**
  - Test: loader error -> retry state, stats '—', no 'No conversations yet'.
  - Success + empty -> empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-AI-CHAT-DETAIL-05

### GAP-AI-CHAT-02  ·  HIGH  ·  partly  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** The first column prints the raw conversation UUID (ConversationsTable.tsx:32,45) — the operator gets no citizen, channel, topic or last message to recognise a conversation; a row that needs a human is indistinguishable from a closed one except by pill.
- **Verified evidence:** ConversationsTable.tsx builds rows with id: conversation.id and the first column key 'id' label 'Conversation' prints it raw (UUID); rowHref links to detail. Other columns are status pill, language, handoff reason, duration, started, ended — so status/handoff reason/queue-related cues exist, contradicting 'indistinguishable except by pill' (handoff reason column shows why). Whether ChatConversation carries citizen/channel/topic/last-message cannot be verified (@civitasone/types and ai-agent-service absent); handoffQueue, handoffNote, language exist per detail page.
- **Files to change:** `apps/web/src/app/(app)/ai/chat/ConversationsTable.tsx`
- **Fix steps:**
  1. Replace UUID display with short ref (formatInternalRef in lib/formatters.ts) and keep full id in the link only.
  2. Add columns/subtitle for handoffQueue and handoffNote (fields already on the type) and a first-message preview if the API provides it (confirm).
  3. Sort or badge 'With agent' rows first.
- **Acceptance:**
  - Row shows short reference, not UUID.
  - Row with handoff shows queue.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-AI-CHAT-04

### GAP-AI-CHAT-03  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Stats are computed over the fetched page only (limit=100, page.tsx:20 + loaders.ts:2916-2923): with more than 100 conversations the 'Conversations' card silently reports at most 100 and 'With agent' can under-count; the StatusFilter comment acknowledges pagination for the list but the cards ignore it.
- **Verified evidence:** getChatConversations calls /api/v1/ai/chat?limit=100 (loaders.ts:2916-2923); summariseConversations (chat.ts) counts only the returned array, so total = min(100,n), and with ?status= filter the other cards read 0. DataTable paginates only client-side (pageSize 20). No total count from API used (response schema chatConversationsListSchema only exposes data in mapResponse; presence of a total field is cannot-verify).
- **Files to change:** `apps/web/src/app/(app)/ai/chat/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/ai/chat/chat.ts`
- **Fix steps:**
  1. Backend: return total and per-status counts (or a /ai/chat/summary endpoint) — confirm against ai-agent-service.
  2. Web: read the counts for StatCards; keep list paged server-side (page/cursor searchParams) instead of one 100-row fetch.
  3. Until then, label cards 'in latest 100' and show '100+' when length===100.
- **Acceptance:**
  - With 150 seeded conversations cards show 150 and correct status split.
  - Filter status=ended keeps the other cards accurate.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Operators may under-see handed-off chats.

### GAP-AI-CHAT-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** A handed-off conversation waiting for an operator has no age/urgency cue: 'With agent' rows show 'In progress' duration and no queue or wait time (ConversationsTable.tsx:36-40) although handoffQueue exists on the type.
- **Verified evidence:** ConversationsTable.tsx (~36-40): duration = 'In progress' whenever endedAt null; no wait time and no queue column, though detail page uses conversation.handedOffAt and handoffQueue (chat/[id]/page.tsx ~86-99), so those fields exist on the type.
- **Files to change:** `apps/web/src/app/(app)/ai/chat/ConversationsTable.tsx`
- **Fix steps:**
  1. Add 'Waiting' column: for status handed_off show elapsed since handedOffAt (client component, format as 'Xm/Xh'), else '—'.
  2. Add 'Queue' column from handoffQueue (fallback 'Unrouted').
  3. Highlight rows waiting beyond threshold (decision on SLA, e.g. 10 min) with StatusPill warn plus text, not colour alone.
  4. Sort handed_off first.
- **Acceptance:**
  - Row handed off 25 min ago shows 'Waiting 25 min' and queue.
  - Non-handed rows show '—'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** SLA threshold needs product input.
- **Depends on:** GAP-AI-CHAT-02

### GAP-AI-CHAT-05  ·  LOW  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Governance action is a plain <a className='btn'> (full reload) rather than Link (page.tsx:28); 'Loading…' next to the filter is plain 12px grey (StatusFilter.tsx:46).
- **Verified evidence:** chat/page.tsx:28 uses <a className='btn' href='/ai/governance'> (full reload); StatusFilter.tsx:46 renders {pending && <span style={{fontSize:12,color:'#64748b'}}>Loading…</span>} next to the select. PageHeader back='/ai' is already used.
- **Files to change:** `apps/web/src/app/(app)/ai/chat/page.tsx`, `apps/web/src/app/(app)/ai/chat/StatusFilter.tsx`
- **Fix steps:**
  1. Replace the anchor with next/link <Link className='btn' href='/ai/governance'>.
  2. Replace the Loading span with shared ds spinner/aria-busy text using theme token colour; add role='status'.
  3. Consider making filter a set of shared tabs.
- **Acceptance:**
  - Governance click does not reload the document (Network tab).
  - Loading text announced by screen reader.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-AI-CHAT-06  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Hard-coded English throughout (no next-intl) and emoji stat icons on fixed hex backgrounds (page.tsx:32-35).
- **Verified evidence:** chat/page.tsx (~32-35) StatCards use emoji icons (💬🟢🙋⚪) with hex iconBg (#e0f2fe/#dcfce7/#fef3c7/#f1f5f9); title, subtitle, labels and all ConversationsTable/StatusFilter strings are English literals; no next-intl import in ai/chat/*. Theme FABRICATED is wrong — it is I18N/theme tokens.
- **Files to change:** `apps/web/src/app/(app)/ai/chat/page.tsx`, `apps/web/src/app/(app)/ai/chat/ConversationsTable.tsx`, `apps/web/src/app/(app)/ai/chat/StatusFilter.tsx`
- **Fix steps:**
  1. Create 'aiChat' namespace in en.json (+ other locales) and move all literals (shared with GAP-AI-CHAT-DETAIL-07).
  2. Swap hex iconBg for tokens (var(--infobg) etc.); use ds icons instead of emoji.
  3. Use getTranslations in page.tsx and useTranslations in client components.
- **Acceptance:**
  - No literal English strings in ai/chat/*.tsx (lint rule).
  - Locale switch changes labels.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-AI-CHAT-DETAIL-07


---
## /ai/chat/[id]  —  `ai/chat-detail.html`

- **Source:** `apps/web/src/app/(app)/ai/chat/[id]/page.tsx`
- **Design reference:** `redesign/ai/chat-detail.html`

### GAP-AI-CHAT-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** 'End conversation' is a single click on a danger button with no ConfirmDialog (EndConversationButton.tsx:75-84); it is irreversible (the service rejects re-opening) and, for a citizen mid-chat, cuts the session.
- **Verified evidence:** EndConversationButton.tsx: <button className='btn danger' onClick={end}> (lines ~62-70) POSTs /api/proxy/v1/ai/chat/:id/end immediately; reason input is optional (label 'Reason (optional)') and no ConfirmDialog is used. The component maps INVALID_TRANSITION to 'already ended', and its header comment says the service rejects re-opening (service not in snapshot -> irreversibility itself is cannot-verify beyond that). ds/ConfirmDialog.tsx exists with requireReason, minReasonLength, danger props. Audit event emission is server-side in ai-agent-service (absent).
- **Files to change:** `apps/web/src/app/(app)/ai/chat/[id]/EndConversationButton.tsx`
- **Fix steps:**
  1. Wrap end() in <ConfirmDialog danger requireReason minReasonLength={10} title='End conversation?' confirmLabel='End conversation'> opened by the button; send reason from the dialog.
  2. Remove the inline optional reason input (or keep as prefill); include reason in the POST body (already supported).
  3. Show version-conflict error (VERSION_CONFLICT) like HandoffButton does.
  4. Verify in ai-agent-service that /end writes an audit event with actor+reason; add if missing (maker-checker not applicable to this operator action).
- **Acceptance:**
  - Component test: click 'End conversation' -> dialog appears, fetch not called until reason>=10 chars and confirm.
  - Cancel leaves conversation active.
  - Backend/audit check: audit row created with reason.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Ending cuts a live citizen chat; confirm wording prominently.
- **Depends on:** ConfirmDialog

### GAP-AI-CHAT-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0-10 note:** review found the W0 tick partly — Role gate (AI_CHAT_READ_ROLES, page.tsx) and maskIdentifiers at render (page.tsx:154) done, but no audit of transcript view or reveal (none in page.tsx; session-routes.ts:116-130 transcript GET has no audit) and no permitted-role reveal flow (Masked component unused); masking is unconditional
- **First-pass claim:** DPDP: full citizen message text (names, PPO numbers, complaints) is printed unmasked to whoever passes the module gate (page.tsx:115-125); no role check or masking is visible in the page or loader.
- **Verified evidence:** chat/[id]/page.tsx renders entry.content in <p style whiteSpace pre-wrap> (~lines 112-118) for every message, unmasked. ai/layout.tsx only wraps ModuleGate moduleKey='ai-agent' (tenant module check, no requireAnyRole); the page and getChatTranscript (loaders.ts ~2941) do no role check or redaction. No <Masked> component exists in apps/web/src (search found none). Whether the service redacts PII is cannot-verify (ai-agent-service absent).
- **Files to change:** `apps/web/src/app/(app)/ai/layout.tsx`, `apps/web/src/app/(app)/ai/chat/[id]/page.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`
- **Fix steps:**
  1. Decision: which roles may read citizen transcripts (e.g. grievance officer, tenant_admin) — add requireAnyRole(...) to ai/chat layout or page.
  2. Create a PII text redactor (mask Aadhaar 12-digit, phone, PPO/account-like numbers, emails) in lib/pii and a <Masked> component; default to masked, reveal per message for permitted roles.
  3. Log every reveal/transcript view via an audit call (POST audit endpoint; confirm existence in ai-agent-service).
  4. Ask service to redact at source if possible.
- **Acceptance:**
  - Unit test redactor on sample text (Aadhaar 1234 5678 9012 -> XXXX XXXX 9012).
  - Unauthorised role redirected; authorised role sees masked text and reveal is audited.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure; over-masking can hurt operators handling live chats.
- **Depends on:** GAP-AI-CHAT-DETAIL-04

### GAP-AI-CHAT-DETAIL-03  ·  HIGH  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** No single-conversation endpoint: getChatConversation downloads the list with limit=200 and picks by id (loaders.ts:2925-2939). A conversation older than the newest 200 renders 'Conversation not found — belongs to another tenant' although it exists.
- **Verified evidence:** loaders.ts:2932-2939 getChatConversation fetches '/api/v1/ai/chat?limit=200' and mapResponse finds by id, returning null when absent; the doc comment at ~2925-2931 admits no single-conversation endpoint. Page then shows 'Conversation not found — ... belongs to another tenant' (page.tsx:38-52). The transcript endpoint /api/v1/ai/chat/:id/history exists separately. Service-side limit/ordering cannot be verified (absent), but any tenant with >200 conversations loses older ones.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/ai/chat/[id]/page.tsx`, `services/ai-agent-service (chat routes; not in snapshot)`
- **Fix steps:**
  1. Backend: add GET /v1/ai/chat/:id returning one ChatConversation (404 for other tenant).
  2. Web: change getChatConversation to call it; map 404 -> null, other errors -> error source.
  3. Until then, fall back gracefully: message 'not in the latest 200' when list is full and id not found.
- **Acceptance:**
  - Contract test: GET /ai/chat/:id for conversation #500 returns it.
  - Web: open a conversation older than the newest 200 -> detail renders.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-AI-CHAT-DETAIL-05

### GAP-AI-CHAT-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Controls are rendered for every role and rely on a 403 after clicking (HandoffButton.tsx:70-72, EndConversationButton.tsx:42-45); the page never learns the caller's role.
- **Verified evidence:** page.tsx never reads session roles (no getSessionRoles/requireAnyRole import); HandoffButton (rendered when active) and EndConversationButton (active/handed_off) show to all who pass ai/layout ModuleGate. Both only handle 403 after the POST (HandoffButton ~line 62-66, EndConversationButton ~line 41-44). Which roles the service permits is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/ai/chat/[id]/page.tsx`, `apps/web/src/app/(app)/ai/layout.tsx`
- **Fix steps:**
  1. Decision + backend read: list roles allowed on POST /ai/chat/:id/handoff and /end.
  2. In page.tsx use getSessionRoles() (lib/auth/roleGuard) to compute canOperate; render controls only if true, else a read-only note.
  3. Keep the 403 handlers; server remains authoritative.
- **Acceptance:**
  - Unit/page test: role without permission sees no buttons.
  - Permitted role sees both.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong role list hides needed controls; source it from the service.
- **Depends on:** GAP-AI-CHAT-DETAIL-02

### GAP-AI-CHAT-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Two error paths disagree: a failed transcript gives RefreshErrorState with stats of 0 (page.tsx:105-107), a failed conversation call gives 'Conversation not found' plus badge (page.tsx:38-52) — an outage is indistinguishable from a wrong id.
- **Verified evidence:** page.tsx:38-52: `if (!conversation)` returns EmptyState 'Conversation not found' with a small badge even when conversationSource==='error'; page.tsx ~105-107: transcript error renders RefreshErrorState while the stat grid above still shows Messages 0 and Tokens 0 (summariseTranscript of []). So both mis-states exist.
- **Files to change:** `apps/web/src/app/(app)/ai/chat/[id]/page.tsx`
- **Fix steps:**
  1. Before the `!conversation` branch: if conversationSource==='error' render RefreshErrorState (toHumanError('load',{area:'conversation'})) and return.
  2. Only show 'not found' when source==='api' and conversation null.
  3. When transcriptSource==='error', pass '—' to Messages and Tokens StatCards (keep Status/Duration).
- **Acceptance:**
  - Test: conversation fetch 500 -> retry state, not 'not found'.
  - Transcript 500 -> stats '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-AI-CHAT-DETAIL-03

### GAP-AI-CHAT-DETAIL-06  ·  MEDIUM  ·  partly  ·  theme WIRING (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Handoff queue is a free-text field (HandoffButton.tsx:122-135, placeholder 'water-supply-tier2') with no list of real queues, and the End-conversation reason asks the operator to 'record here if this was handed to a human agent' although handoff is a separate control — two ways to record one fact.
- **Verified evidence:** HandoffButton.tsx: queue is <input type=text maxLength=64 placeholder='e.g. water-supply-tier2'> (~lines 120-135) with no source of valid queues (no queue-list endpoint referenced anywhere; existence in service cannot-verify). EndConversationButton.tsx label 'Reason (optional) — record here if this was handed to a human agent' and placeholder 'escalated to the water supply desk' conflicts with the separate handoff state. The placeholders are examples, not fabricated figures; the real defects are free-text routing and the misleading label.
- **Files to change:** `apps/web/src/app/(app)/ai/chat/[id]/HandoffButton.tsx`, `apps/web/src/app/(app)/ai/chat/[id]/EndConversationButton.tsx`
- **Fix steps:**
  1. Change End reason label to 'Reason for ending (optional)'; drop the handoff wording and example.
  2. If service exposes queues, replace the queue input with a select loaded server-side; otherwise decision on canonical queue slugs.
  3. Show a hint in End dialog linking to handoff for escalation.
- **Acceptance:**
  - Label no longer mentions handoff.
  - Queue is chosen from list; free text cannot be submitted (if list exists).
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Wrong queue name strands a citizen chat.
- **Depends on:** GAP-AI-CHAT-DETAIL-01

### GAP-AI-CHAT-DETAIL-07  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Hard-coded English, emoji status icons on fixed hex backgrounds (page.tsx:60-61), and green/red message colours are inline hex (#047857/#b42318) in both action components.
- **Verified evidence:** page.tsx:60-61 uses emoji icons and fixed hex backgrounds (#dcfce7/#fef3c7/#f1f5f9), other StatCards use #e0f2fe/#fef3c7/#fce7f3; strings ('Conversation', 'Started', 'Transcript', 'Handed to a human agent') are English literals, no getTranslations. Message colours #047857 and #b42318 are inline in EndConversationButton.tsx and HandoffButton.tsx. Also inline #475569/#64748b greys.
- **Files to change:** `apps/web/src/app/(app)/ai/chat/[id]/page.tsx`, `apps/web/src/app/(app)/ai/chat/[id]/EndConversationButton.tsx`, `apps/web/src/app/(app)/ai/chat/[id]/HandoffButton.tsx`
- **Fix steps:**
  1. Add an 'aiChat' namespace to en.json (+ hi/or) and use getTranslations/useTranslations for all literals.
  2. Replace hex with theme tokens (var(--goodbg), var(--good), var(--bad) as used in hr workforce page) and existing status classes.
  3. Replace emoji icons with the ds icon set or StatusPill; mark decorative icons aria-hidden.
- **Acceptance:**
  - Grep: no '#[0-9a-f]{6}' in ai/chat/**.
  - Switching locale changes labels; dark theme readable.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /ai/copilot  —  `ai/copilot.html`

- **Source:** `apps/web/src/app/(app)/ai/copilot/page.tsx`
- **Design reference:** `redesign/ai/copilot.html`

### GAP-AI-COPILOT-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Failed fetch reads as an empty history: loader returns [] so stats are 0 and the table says 'Ask the copilot a question above…' (page.tsx:22-34, TurnHistoryTable.tsx:58-62); only a small badge signals the failure.
- **Verified evidence:** copilot/page.tsx:11 destructures data/source; getCopilotTurns falls back to [] on error (loaders.ts:2953). Stats render summary.total etc. as 0 (l.24-26, 0 not '—') and TurnHistoryTable shows emptyTitle 'No copilot turns yet' (TurnHistoryTable.tsx:220-221). Only DataSourceBadge at l.22 signals failure. (Line refs in observation 22-34 correct; empty text is at TurnHistoryTable.tsx:220-221 not 58-62.)
- **Files to change:** `apps/web/src/app/(app)/ai/copilot/page.tsx`, `apps/web/src/app/(app)/ai/copilot/TurnHistoryTable.tsx`
- **Fix steps:**
  1. In page.tsx branch on source==='error': render <RefreshErrorState error={toHumanError('load',{area:'copilot history'})}/> in the Turn History Card instead of TurnHistoryTable.
  2. Pass value '—' to the three count StatCards when errored (StatCard already maps null to '—').
  3. Keep AskCopilotForm rendered so the user can still submit.
- **Acceptance:**
  - Test: source 'error' -> no 'No copilot turns yet', stats show '—', retry button present.
  - Source api with [] still shows the empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-AI-COPILOT-02  ·  HIGH  ·  partly  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** DPDP: nothing warns the officer before submitting that a prompt is stored in full (32,000 chars) and listed to everyone with access; the guardrail runs server-side after send (AskCopilotForm.tsx:48-52) so PII typed into the box has already left the browser when the block message appears.
- **Verified evidence:** AskCopilotForm.tsx:79-94 POSTs the prompt to /api/proxy/v1/ai/copilot/ask and only then learns of a 422 GUARDRAIL_BLOCKED, so the text has left the browser; true. There is no warning copy near the textarea (l.120-134), only a char counter (max 32000 at l.48). Whether the blocked prompt is persisted server-side, and who can list turns, cannot be seen (ai-agent-service absent). Stored-in-full and visible-to-all is inferred from the list/detail pages, not verified in the service.
- **Files to change:** `apps/web/src/app/(app)/ai/copilot/AskCopilotForm.tsx`, `apps/web/src/lib/pii.ts (new)`
- **Fix steps:**
  1. Add helper text under the textarea: prompts are recorded in full with the response and visible to authorised staff; do not enter Aadhaar, PAN, bank or PPO numbers.
  2. Add client-side pre-check using pii.ts detectIdentifiers(); show an inline warning and require confirmation before sending (advisory, server guardrail remains authoritative).
  3. Keep the server 422 handling.
- **Acceptance:**
  - Test: typing a 12-digit Aadhaar shows the warning before submit.
  - Manual: notice visible with no data typed.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Client regex is advisory only; must not replace the server guardrail.
- **Depends on:** GAP-AI-COPILOT-DETAIL-03

### GAP-AI-COPILOT-03  ·  MEDIUM  ·  confirmed  ·  theme LOADING (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Answers are asynchronous (202) but the page never refreshes itself: the new turn shows 'Awaiting' until the user reloads (AskCopilotForm.tsx:66-68 calls router.refresh() once); the detail page says 'Reload this page in a moment' (copilot/[id]/page.tsx:76-80).
- **Verified evidence:** AskCopilotForm.tsx:110 calls router.refresh() once after 202; the new turn appears with state Awaiting (copilot.ts:242 turnState) and nothing re-polls. Detail page copy tells the user to reload (copilot/[id]/page.tsx:79).
- **Files to change:** `apps/web/src/app/(app)/ai/copilot/AutoRefresh.tsx (new)`, `apps/web/src/app/(app)/ai/copilot/page.tsx`, `apps/web/src/app/(app)/ai/copilot/[id]/page.tsx`
- **Fix steps:**
  1. Create client <AutoRefresh> (setInterval + router.refresh, 5s, stop when no awaiting turns or after ~2 min).
  2. Mount it in page.tsx when summary.awaiting>0 and in the detail page when !answered.
  3. Change the detail copy to state the page refreshes automatically.
- **Acceptance:**
  - Fake-timer test: refresh called every 5s while awaiting, not after.
  - Manual: submit a prompt, status flips to Answered without reload.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Polling load on ai-agent-service; keep the interval and cap.
- **Depends on:** GAP-AI-COPILOT-DETAIL-04

### GAP-AI-COPILOT-04  ·  MEDIUM  ·  confirmed  ·  theme PAGINATION (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Only the newest 50 turns are fetched (loaders.ts:2952-2955) and stats are computed over them, so 'Turns' tops out at 50 with no pager or hint.
- **Verified evidence:** loaders.ts:2953 requests `/api/v1/ai/copilot/turns?limit=50`; summariseTurns(turns) (copilot.ts:255) counts only that slice, so Turns/Answered/Awaiting max at 50 combined; no pager or hint. Service-side pagination params beyond limit are not visible (service absent).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/ai/copilot/page.tsx`
- **Fix steps:**
  1. Decision: does the service expose totals or a cursor/offset? If yes, extend getCopilotTurns and use them for the stat cards.
  2. Otherwise label the cards 'Last 50 turns' and add a note when turns.length===50.
  3. Add next/prev paging via searchParams once the backend supports it.
- **Acceptance:**
  - With 50 rows returned, UI shows 'Showing latest 50'.
  - With server totals, Turns stat matches total.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; misleading counts only.

### GAP-AI-COPILOT-05  ·  LOW  ·  partly  ·  theme DARKMODE (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Textarea and inputs use inline light-mode colours (#475569, #047857, #b42318) and fixed padding (AskCopilotForm.tsx:83-125); the 'Ask' button is 44px while the header actions use default height.
- **Verified evidence:** AskCopilotForm.tsx uses inline #475569 (l.122), #047857 (l.145), #b42318 (l.150,155), #64748b (l.136), padding 10 on textarea (l.133). Ask button has minHeight 44 (l.139) while the header action is a plain `btn` (page.tsx:20). Line range 83-125 is off; real 122-158. Effect in dark mode not tested.
- **Files to change:** `apps/web/src/app/(app)/ai/copilot/AskCopilotForm.tsx`
- **Fix steps:**
  1. Replace inline colours with DS classes/CSS variables (e.g. text-muted, ok/err tokens from civitas-ds.css).
  2. Use the DS input class for the textarea.
  3. Standardise button height via a shared btn size class.
- **Acceptance:**
  - Dark mode (.dark): label, status and error text readable.
  - Visual: Ask and header buttons equal height.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-AI-COPILOT-06  ·  LOW  ·  partly  ·  theme I18N (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Hard-coded English, emoji stat icons (page.tsx:24-34); the truncated prompt column gives no full-text tooltip (copilot.ts:56-60).
- **Verified evidence:** Emoji icons and fixed hex iconBg at page.tsx:24-33 are true; English strings are hard-coded (no next-intl in this page). truncatePrompt (copilot.ts:280) cuts to 90 chars and TurnHistoryTable.tsx:193 passes only the truncated text, so no full text/tooltip. Not fabricated data, so theme is wrong. Line ref 56-60 should be 280-284.
- **Files to change:** `apps/web/src/app/(app)/ai/copilot/TurnHistoryTable.tsx`, `apps/web/src/app/(app)/ai/copilot/page.tsx`
- **Fix steps:**
  1. Keep full prompt in the row (fullPrompt) and render truncated with title={fullPrompt} via a column render.
  2. Extract strings to next-intl keys if the module adopts it (decision).
  3. Replace emoji/hex with StatIcon tokens.
- **Acceptance:**
  - Hover over a truncated prompt shows the full text (or an accessible expand).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Full prompt in a title attribute exposes PII in tooltips; apply masking first.
- **Depends on:** GAP-AI-COPILOT-DETAIL-03


---
## /ai/copilot/[id]  —  `ai/copilot-detail.html`

- **Source:** `apps/web/src/app/(app)/ai/copilot/[id]/page.tsx`
- **Design reference:** `redesign/ai/copilot-detail.html`

### GAP-AI-COPILOT-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** A service failure is presented as 'Turn not found — does not exist, or belongs to another tenant' (page.tsx:25-42): `!turn || source === "error"` collapses outage and 404 into one message, badge notwithstanding.
- **Verified evidence:** copilot/[id]/page.tsx:25 `if (!turn || source === "error")` renders one EmptyState 'Turn not found ... belongs to another tenant' (l.32-36) for both outage and missing turn; DataSourceBadge (l.29) is the only differentiator. LoaderResult from fetchJson (app/_data/apiClient.ts:144) carries `status`, so a real 404 is distinguishable.
- **Files to change:** `apps/web/src/app/(app)/ai/copilot/[id]/page.tsx`
- **Fix steps:**
  1. Destructure `status` from getCopilotTurn(params.id).
  2. If source==='error' && status!==404 render <RefreshErrorState error={toHumanError('load',{area:'copilot turn'})} backHref='/ai/copilot'/> inside the Card, drop the not-found copy.
  3. Keep the 'Turn not found' EmptyState only for status===404 or (source==='api' && !turn).
  4. Optionally call notFound() for the true 404 case.
- **Acceptance:**
  - Component/page test: mock getCopilotTurn -> {source:'error',status:503}: RefreshErrorState with Retry shown, no 'Turn not found' text.
  - Mock {source:'error',status:404}: 'Turn not found' shown.
  - Manual: stop ai-agent-service, open /ai/copilot/<id>, see retry state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentational only.
- **Depends on:** RefreshErrorState

### GAP-AI-COPILOT-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme XSS (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Citation url is placed straight into href (page.tsx:95-97) with no scheme allow-list; a retrieved document with a javascript: or data: URL would render as a live link. rel/target are set correctly, but the value comes from the model's retrieval payload.
- **Verified evidence:** copilot/[id]/page.tsx:96 renders `<a href={citation.url}>` with no scheme check; rel='noreferrer noopener' target='_blank' are set. Citation url comes from copilotTurnDetailSchema payload (loaders.ts:2968-2981, no URL validation seen in mapResponse). React 18 does not block javascript: hrefs; target=_blank reduces but does not remove risk (middle-click/copy). Schema definition itself not inspected in the packages snapshot.
- **Files to change:** `apps/web/src/app/(app)/ai/copilot/[id]/page.tsx`, `apps/web/src/lib/safeUrl.ts (new)`, `apps/web/src/lib/safeUrl.test.ts (new)`
- **Fix steps:**
  1. Add safeHttpUrl(url): parse with new URL(url, undefined) in try/catch and return it only if protocol is http: or https:, else null.
  2. In page.tsx l.95-97 use safeHttpUrl(citation.url); if null render the title as plain text (optionally show the raw url as non-link text).
  3. Also tighten the zod schema for sourceCitations[].url with z.string().url().refine(http/https) at the loader boundary if the schema lives in web.
  4. Unit-test javascript:, data:, vbscript:, relative, https.
- **Acceptance:**
  - Unit: safeHttpUrl('javascript:alert(1)') === null; 'https://x.gov.in/a' passes.
  - Component: citation with url javascript:alert(1) renders no <a>.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; internal-only relative URLs would be dropped unless handled explicitly.

### GAP-AI-COPILOT-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** DPDP: the full prompt and response are shown unmasked to any module user (page.tsx:68-83); a prompt containing an Aadhaar or PPO number is displayed as typed, with no masking or role gate.
- **Verified evidence:** Prompt and response are printed as-is (page.tsx:68-83, whiteSpace pre-wrap) and the list shows the first 90 chars (copilot.ts truncatePrompt). Access is gated only by ModuleGate moduleKey='ai-agent' (ai/layout.tsx). No <Masked> component exists anywhere in apps/web or packages/ui-kit. A server-side guardrail exists (AskCopilotForm.tsx:90 handles 422 GUARDRAIL_BLOCKED), so some PII may be blocked before storage; that service is not in the snapshot, so what it blocks is unverified. No view audit event is emitted from the page.
- **Files to change:** `apps/web/src/app/(app)/ai/copilot/[id]/page.tsx`, `apps/web/src/app/(app)/ai/copilot/TurnHistoryTable.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`, `apps/web/src/lib/pii.ts (new)`
- **Fix steps:**
  1. Decision first: which roles may see raw prompts (owner of the turn, ai_admin) versus masked.
  2. Create pii.ts maskIdentifiers(text) for Aadhaar (12 digits), PAN, PPO patterns, and a client <Masked> with reveal button.
  3. Wrap prompt/response in <Masked> on the detail page and the truncated prompt in TurnHistoryTable.
  4. On reveal POST an audit event via the existing audit path (backend endpoint needs confirming; not seen in snapshot).
- **Acceptance:**
  - Unit: maskIdentifiers('1234 5678 9012') -> 'XXXX XXXX 9012'.
  - Manual: non-admin sees masked prompt; reveal logs an audit event.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure; regex masking has false negatives, do not present as a guarantee.
- **Depends on:** GAP-AI-COPILOT-02

### GAP-AI-COPILOT-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme LOADING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Pending turn: page says 'Reload this page in a moment' (page.tsx:76-80) — no auto-refresh; and the Sources card claims 'answered without citing retrieved documents' while the answer does not exist yet (page.tsx:86-92).
- **Verified evidence:** Confirmed: pending turn shows 'Reload this page in a moment' (page.tsx:79) and the page is a static Server Component (dynamic data, revalidateSeconds:0, no polling). Sources card (l.84-92) says 'answered without citing retrieved documents' even when answered===false. Not a dead route, so the theme is wrong; it is a stale/pending-state issue.
- **Files to change:** `apps/web/src/app/(app)/ai/copilot/[id]/page.tsx`, `apps/web/src/app/(app)/ai/copilot/AutoRefresh.tsx (new)`
- **Fix steps:**
  1. Add a small client <AutoRefresh active intervalMs={5000} maxMs={120000}> that calls router.refresh() while the turn is awaiting.
  2. Render it when !answered, and reword copy to 'Waiting for the answer... this page updates automatically'.
  3. In the Sources card, if !answered show 'Sources appear once the answer is ready' instead of 'No sources cited'.
- **Acceptance:**
  - Component: with an awaiting turn, fake timers advance 5s -> router.refresh called; stops after answered.
  - Manual: ask a question, open detail, answer appears without reload.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; cap polling to avoid load on the service.
- **Depends on:** GAP-AI-COPILOT-03

### GAP-AI-COPILOT-DETAIL-05  ·  LOW  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Relevance scores print as raw 0.00 numbers (page.tsx:100) and citations without id/title show 'Untitled source'; emoji stat icons on fixed hex backgrounds (page.tsx:52-66).
- **Verified evidence:** page.tsx:100 prints `relevance {score.toFixed(2)}` (raw 0-1 float) and l.97 falls back to 'Untitled source'; StatCard icons are emoji with fixed hex iconBg (l.52-66: #dcfce7,#fef3c7,#e0f2fe,#fce7f3), which do not adapt in .dark mode (civitas-ds.css:317).
- **Files to change:** `apps/web/src/app/(app)/ai/copilot/[id]/page.tsx`
- **Fix steps:**
  1. Show relevance as a percentage (Math.round(score*100)+'% match') with a title tooltip of the raw score.
  2. For citations lacking title and id, show a localised 'Untitled source' plus the url host if available.
  3. Replace hex iconBg with DS tokens/classes used by other StatCards or drop the override.
- **Acceptance:**
  - Visual: score 0.874 shows '87% match'.
  - Dark mode: stat icon backgrounds remain readable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /ai/governance  —  `ai/governance.html`

- **Source:** `apps/web/src/app/(app)/ai/governance/page.tsx`
- **Design reference:** `redesign/ai/governance.html`

### GAP-AI-GOVERNANCE-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** On a failed fetch the page reports health: counters default to 0 (page.tsx:29-31,43-62), the band reads 'Within normal range' in green (page.tsx:11-17,65-67) and the kill-switch card says 'No agents defined' (AgentKillSwitch.tsx:51-52). Only the Top Block Reasons card shows an error (page.tsx:75-77).
- **Verified evidence:** governance/page.tsx:28 computes source but counters default to 0 (l.29,48,54,61) and blockRatePct 0 gives band 'normal' green 'Within normal range' (l.65-67). AgentKillSwitch.tsx:149-150 shows 'No agents defined' when agents is []. Only the Top Block Reasons card uses RefreshErrorState (l.75-76). The audit table shows 'No AI actions recorded' on error (AuditTrailTable.tsx:232-241).
- **Files to change:** `apps/web/src/app/(app)/ai/governance/page.tsx`, `apps/web/src/app/(app)/ai/governance/AgentKillSwitch.tsx`, `apps/web/src/app/(app)/ai/governance/AuditTrailTable.tsx`
- **Fix steps:**
  1. Track counters/audit/agents errors separately; when counters.source==='error' pass '—' to the four StatCards and hide the band paragraph.
  2. Render RefreshErrorState in the audit card when audit.source==='error' and in the kill-switch when agents.source==='error' (add an `error` prop to AgentKillSwitch/AuditTrailTable).
  3. Never show the 'Within normal range' band unless counters.data is non-null.
- **Acceptance:**
  - Test: counters error -> stats '—', no green band.
  - Agents error -> retry state, not 'No agents defined'.
  - Manual: stop service, page shows three retry states.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** High-stakes: a false 'normal' on an AI safety screen.
- **Depends on:** RefreshErrorState

### GAP-AI-GOVERNANCE-03  ·  MEDIUM  ·  confirmed  ·  theme DATA-SCOPE (was I18N)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Block-rate band and 'Top Block Reasons' mix scopes: counters come from the dashboard endpoint but reasons are computed from the latest 100 audit rows only (_data.ts:109-130, governance.ts:130-150), so the two can contradict each other, and there is no 'window' label though the copy says 'in this window'.
- **Verified evidence:** Counters come from /api/v1/ai/governance/dashboard (_data.ts:101), audit from `/audit?limit=100` (_data.ts:112), and topBlockReasons(audit.data) (page.tsx:31, governance.ts:390) counts only those rows, so reasons can diverge from blockedCount. Copy 'in this window' (page.tsx:78, AuditTrailTable.tsx:238) has no window label. Theme is wrong (scope mismatch, not i18n).
- **Files to change:** `apps/web/src/app/(app)/ai/governance/page.tsx`, `apps/web/src/app/(app)/ai/governance/AuditTrailTable.tsx`, `apps/web/src/app/(app)/ai/_data.ts`
- **Fix steps:**
  1. Label the reasons card 'From the latest 100 audit entries' and the empty copy accordingly.
  2. Decision: ask backend for a reasons aggregate (or window params) on the dashboard endpoint; not seen in snapshot.
  3. If dashboard has a window, show it next to the counters.
- **Acceptance:**
  - Reasons card shows its scope label.
  - After backend change, sum of reasons equals blockedCount.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-AI-GOVERNANCE-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Agent column prints the raw agentId (AuditTrailTable.tsx:27) while the kill-switch beside it lists agent names — the operator cannot tie a blocked action to an agent to pause without cross-referencing ids.
- **Verified evidence:** AuditTrailTable.tsx:215 `agent: e.agentId ?? "—"` prints the raw id; AgentKillSwitch lists agent.name from getAiAgentStatuses (governance/page.tsx:25,93). Page has both lists so a join is possible client-side.
- **Files to change:** `apps/web/src/app/(app)/ai/governance/page.tsx`, `apps/web/src/app/(app)/ai/governance/AuditTrailTable.tsx`
- **Fix steps:**
  1. Pass agents.data to AuditTrailTable as `agents`.
  2. Build id->name map; show name (id short in title attribute); fall back to id when unknown.
  3. Optionally link the name to the kill-switch card anchor.
- **Acceptance:**
  - Test: entry with agentId a1 and agent {id:a1,name:'Drafter'} shows 'Drafter'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; agents list limited to 100 so fall back to id.

### GAP-AI-GOVERNANCE-05  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Kill-switch is shown to every viewer and relies on a 403 message (AgentKillSwitch.tsx:30-38, and only when body.code is FORBIDDEN, else 'Could not pause the agent'); the comment in the file acknowledges hiding is not authorisation, but the control could still be disabled with an explanation for non-admins.
- **Verified evidence:** AgentKillSwitch.tsx renders Pause/Resume for all viewers (l.165-173); 403 is mapped only when body.code==='FORBIDDEN' (l.131), otherwise generic 'Could not ...'. Comment l.106-110 states the service enforces ai_admin/super_admin; service not in snapshot so enforcement cannot be verified. No role hook is used in this component; a client role guard helper would need to be located.
- **Files to change:** `apps/web/src/app/(app)/ai/governance/AgentKillSwitch.tsx`, `apps/web/src/app/(app)/ai/governance/page.tsx`
- **Fix steps:**
  1. Find the shared role guard/hook used elsewhere in apps/web and read roles in page.tsx (server) to pass canManage.
  2. When !canManage render buttons disabled with a title/explanatory line 'Requires AI administrator'.
  3. Keep the 403 handling; also map 403 status regardless of body.code.
- **Acceptance:**
  - Non-admin sees disabled buttons plus explanation.
  - Admin can pause/resume; forced 403 still shows the admin message.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Client gating is UX only; backend enforcement must be verified separately.

### GAP-AI-GOVERNANCE-06  ·  LOW  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Audit 'When' uses formatIndianDate (date only, AuditTrailTable.tsx:25) — no time for an audit trail; Reason is free text from the service and may echo prompt content (DPDP), unmasked.
- **Verified evidence:** AuditTrailTable.tsx:213 uses formatIndianDate (formatters.ts:2, dd/mm/yyyy only, no time). Reason is e.reason as returned (l.217) shown unmasked; whether the service redacts prompt text in reason cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/ai/governance/AuditTrailTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatIndianDateTime(iso) to formatters.ts (en-IN, date + hh:mm:ss) and use it for `when`.
  2. Sort by raw ISO, not display string (keep createdAt in the row).
  3. Apply <Masked>/maskIdentifiers to reason once created (see COPILOT-DETAIL-03).
- **Acceptance:**
  - Row shows date and time.
  - Sorting 'When' is chronological.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-AI-COPILOT-DETAIL-03

### GAP-AI-GOVERNANCE-07  ·  LOW  ·  partly  ·  theme DARKMODE (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Health colours (#047857/#92400e/#b42318) are inline hex, and the band is the only non-colour-independent cue: text is present, but no icon (page.tsx:65-67).
- **Verified evidence:** page.tsx:17 BAND_COLOUR holds inline hex; band is text (l.65-67) so it is not colour-only, but has no icon. Observation wording 'non-colour-independent' is garbled; the text label does provide a non-colour cue.
- **Files to change:** `apps/web/src/app/(app)/ai/governance/page.tsx`
- **Fix steps:**
  1. Move colours to DS status classes (pill good/warn/bad).
  2. Add a leading icon (check/alert/octagon) with aria-hidden.
- **Acceptance:**
  - Dark mode contrast passes.
  - Band shows icon plus text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /ai/guardrails  —  `ai/guardrails.html`

- **Source:** `apps/web/src/app/(app)/ai/guardrails/page.tsx`
- **Design reference:** `redesign/ai/guardrails.html`

### GAP-AI-GUARDRAILS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Failed fetch reads as an empty list: loader returns [] and the table shows 'No records — Nothing to show yet' (ai/_data.ts:86-94, ModuleListTable.tsx:35); on the Guardrails page this can mean 'no safety rules in force' when the service is merely unreachable.
- **Verified evidence:** guardrails/page.tsx:8 passes {data,source} to ModuleListPage; getAiGuardrails falls back to [] (ai/_data.ts:89,97). ModuleListTable.tsx:34-35 shows 'No records / Nothing to show yet' when data empty; the provenance badge is the only cue (l.33). Nuance: useSeededResource may serve a cached copy, so this is only fully wrong with no cache.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. In ModuleListTable, when provenance is error-no-data render <RefreshErrorState> instead of the EmptyState.
  2. Allow ModuleListPage to accept emptyTitle/emptyMessage so Guardrails can say 'No guardrail rules are configured'.
  3. Same fix benefits every ModuleListPage user.
- **Acceptance:**
  - Provenance error-no-data -> retry state.
  - Empty api result -> the custom empty message.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared component; regression check other module lists.
- **Depends on:** RefreshErrorState

### GAP-AI-GUARDRAILS-02  ·  MEDIUM  ·  confirmed  ·  theme GENERIC-TABLE (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Generic five-column table for a domain list: ID is truncated to 8 chars (ModuleListTable.tsx:50) with no way to copy the full id; Detail/Meta are guessed from whichever field exists first (ai/_data.ts:50-78), so the same column may show a status word, a description or a timestamp on different rows.
- **Verified evidence:** ModuleListTable.tsx:50 prints row.id.slice(0,8) with no copy; mapRows (_data.ts:36-85) picks label/sublabel/meta from first available field, so Detail/Meta vary by row. Theme wrong (not i18n).
- **Files to change:** `apps/web/src/app/(app)/ai/guardrails/page.tsx`, `apps/web/src/app/(app)/ai/_data.ts`
- **Fix steps:**
  1. Build a Guardrails-specific table (DataTable) with typed columns instead of the generic mapRows once the rule schema is confirmed.
  2. Add title={row.id} and a copy button on the id cell.
  3. Decision: obtain rule fields from ai-agent-service (not in snapshot).
- **Acceptance:**
  - Full id available via hover/copy.
  - Each column always shows the same field.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-AI-GUARDRAILS-03  ·  MEDIUM  ·  partly  ·  theme INFO-GAP (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Rules are read-only and unexplained: there is no rule code, scope or action (block/redact) column, only whatever mapRows picks for Detail/Meta (ai/_data.ts:50-78); reviewers cannot tell what a rule does from this page.
- **Verified evidence:** Table columns are fixed ID/Name/Detail/Status/Meta (ModuleListTable.tsx:40-44) fed by mapRows (_data.ts:36-85), which only looks for description/status/code etc. Whether the service returns scope/action fields is not visible, so the missing columns may need backend. Not a dead route.
- **Files to change:** `apps/web/src/app/(app)/ai/guardrails/page.tsx`, `apps/web/src/app/(app)/ai/_data.ts`
- **Fix steps:**
  1. Confirm the /api/v1/ai/guardrails/rules response shape with the service owner.
  2. Add typed mapGuardrailRules() (like governance.ts) with code, scope, action, enabled.
  3. Render those columns with DataTable.
- **Acceptance:**
  - Each rule shows code, scope, action, status.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-AI-GUARDRAILS-02

### GAP-AI-GUARDRAILS-04  ·  MEDIUM  ·  partly  ·  theme NAVUX (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** The tile description promises 'Safety policies, content filtering, and governance' but the page has no create/enable/disable action and no link to the audit trail of blocked prompts on /ai/governance.
- **Verified evidence:** Page (guardrails/page.tsx) is read-only with no actions or link to /ai/governance; ai/page.tsx:435 tile promises 'Safety policies, content filtering, and governance'. Read-only may be intentional; no create/toggle endpoint verified in the snapshot. The governance page exists and supports ?blocked=true (governance/page.tsx:20).
- **Files to change:** `apps/web/src/app/(app)/ai/guardrails/page.tsx`, `apps/web/src/app/(app)/ai/page.tsx`
- **Fix steps:**
  1. Add a PageHeader action linking to /ai/governance?blocked=true ('View blocked prompts').
  2. Reword the tile to say 'View safety policies' if editing is out of scope.
  3. Decision: rule enable/disable needs a backend endpoint; do not add UI until confirmed.
- **Acceptance:**
  - Link navigates to filtered audit trail.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-AI-GUARDRAILS-05  ·  LOW  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Back navigation is a plain <a href="/ai"> (full page load) with a lucide icon, not PageHeader back/Link (page.tsx:11-13).
- **Verified evidence:** guardrails/page.tsx:11-13 uses <nav class=back><a href='/ai'> with lucide ArrowLeft, and ModuleListPage renders its own PageHeader without `back`; sibling pages pass back='/ai' to PageHeader (copilot/page.tsx:19, governance/page.tsx:38). Plain <a> triggers a full load.
- **Files to change:** `apps/web/src/app/(app)/ai/guardrails/page.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Add optional back/backLabel props to ModuleListPage and forward to PageHeader.
  2. Remove the hand-made nav and lucide import from guardrails/page.tsx.
- **Acceptance:**
  - Back goes client-side to /ai.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## Backend verification items (service code absent from snapshot)

### GAP-AI-GOVERNANCE-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0-10 note:** review found the W0 tick partly — ConfirmDialog added (AgentKillSwitch.tsx:119-133) but dialog says optional reason is 'recorded in the audit trail' while ai-agent-service pause/resume route ignores it (agents/routes.ts:208-229 passes only id+version; commands.ts:41-55; consumer audits reason:null), so the audit-trail claim is false
- **First-pass claim:** Pause is a one-click danger button with no ConfirmDialog (AgentKillSwitch.tsx:66-76): a mis-click halts a live citizen-facing agent, and the audit of that mutation is not shown here (whether ai-agent-service records it is undeterminable).
- **Service:** `ai-agent-service`  ·  **Endpoint(s):** `POST /api/v1/ai/agents/{id}/pause and /resume`
- **Question:** Does pause/resume require an AI-governance role, emit an audit event with actor and reason, and is it idempotent?
- **How to verify:** Open the ai-agent-service agents route; curl pause as unprivileged user expecting 403, twice as privileged expecting 200 both times; check audit store.
- **Test to add:** Given governance role, when POST pause on a live agent, then 200, status=paused and audit event {actor, agentId}; repeat pause returns 200 without duplicate side effects.
- **Impact if wrong:** Live citizen-facing agent halted without trace or by an unauthorised user.
- **Web change if wrong:** Add ConfirmDialog with reason field to AgentKillSwitch.tsx.
