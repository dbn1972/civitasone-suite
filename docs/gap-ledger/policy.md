# Detailed gap file — module `policy`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 21, BACKEND-VERIFY 3



---
## /policy  —  `policy/home.html`

- **Source:** `apps/web/src/app/(app)/policy/page.tsx`
- **Design reference:** `redesign/policy/home.html`

### GAP-POLICY-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Bindings tile promises "break-glass" (page.tsx:11) but no break-glass control exists on /policy/bindings; break-glass lives under tenant-admin/breakglass.
- **Verified evidence:** policy/page.tsx:10 tile note says 'User ↔ role bindings and break-glass' but policy/bindings contains only BindingCreateForm.tsx, loading.tsx and page.tsx; grep for 'break' in that folder returns nothing. Break-glass exists at (app)/tenant-admin/breakglass (page.tsx, BreakglassActions, BreakglassTable).
- **Files to change:** `apps/web/src/app/(app)/policy/page.tsx`
- **Fix steps:**
  1. Change the Bindings note to 'User ↔ role bindings'.
  2. Add a separate tile { href:'/tenant-admin/breakglass', label:'Break-glass access', note:'Emergency access requests (Tenant Admin)' } or omit it.
- **Acceptance:**
  - Manual: Bindings tile text no longer mentions break-glass.
  - If tile added, it navigates to /tenant-admin/breakglass.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-POLICY-HOME-04

### GAP-POLICY-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Loading state is a bare paragraph "Loading policy…" (loading.tsx:3-5) inside .page-main, unlike plugins which ships a shimmer skeleton; no error.tsx so a thrown loader error falls to the app-level boundary.
- **Verified evidence:** policy/loading.tsx:3-5 is a bare <p>Loading policy…</p>; sub-routes each have their own bare loading.tsx (e.g. evaluate/loading.tsx returns only <p>). plugins/loading.tsx uses shimmer bars, and ds/Skeleton.tsx exports SkeletonCard/SkeletonTable. No error.tsx under policy/; (app)/error.tsx and procurement/error.tsx exist, so errors fall to the app-level boundary.
- **Files to change:** `apps/web/src/app/(app)/policy/loading.tsx`, `apps/web/src/app/(app)/policy/evaluate/loading.tsx`, `apps/web/src/app/(app)/policy/abac/loading.tsx`, `apps/web/src/app/(app)/policy/bindings/loading.tsx`, `apps/web/src/app/(app)/policy/role-features/loading.tsx`, `apps/web/src/app/(app)/policy/error.tsx`
- **Fix steps:**
  1. Rewrite policy/loading.tsx to render <SkeletonCard> tiles in .page-main wrap with aria-busy.
  2. Use <SkeletonTable> in abac, bindings and role-features loading.tsx; a form skeleton for evaluate.
  3. Add policy/error.tsx copied from procurement/error.tsx pattern with a Back to Policy action.
- **Acceptance:**
  - Throttle network: skeleton appears, no layout jump.
  - Force loader throw in role-features: policy/error.tsx renders, not the global one.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-POLICY-HOME-04  ·  LOW  ·  partly  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** First tile leaves the module for /tenant-admin/roles (page.tsx:9) with no marker that it is a different section.
- **Verified evidence:** policy/page.tsx:9 links to /tenant-admin/roles with note 'Role catalogue and permission grids (existing)'. ModuleHub/LinkTiles only take href,label,note, so there is no section marker; the '(existing)' wording is internal build jargon shown to users.
- **Files to change:** `apps/web/src/app/(app)/policy/page.tsx`, `apps/web/src/app/_components/ModuleHub.tsx`
- **Fix steps:**
  1. Drop '(existing)' from the note.
  2. Append 'Opens Tenant Admin' to the note, or add an optional `external` badge prop to ModuleHub links and LinkTiles.
- **Acceptance:**
  - Tile text has no '(existing)'.
  - Tile visibly indicates it leaves Policy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-POLICY-HOME-02


---
## /policy/abac  —  `policy/abac.html`

- **Source:** `apps/web/src/app/(app)/policy/abac/page.tsx`
- **Design reference:** `redesign/policy/abac.html`

### GAP-POLICY-ABAC-01  ·  HIGH  ·  confirmed  ·  theme MISSING-DATA (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Rules are shown without their conditions: the type carries expression.predicates (_data.ts:24-30) but the table renders only action, resourceType and effect (page.tsx:44-63), so an admin cannot tell what a deny rule actually matches.
- **Verified evidence:** apps/web/src/app/(app)/policy/_data.ts:20-25 AbacRuleRow.expression has predicates?: unknown[]; apps/web/src/app/(app)/policy/abac/page.tsx:39-58 table columns are Action, Resource, Effect, Role, Enabled, Id and never render predicates. Shape of predicates is unknown (typed unknown[]), so backend schema is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/policy/abac/page.tsx`, `apps/web/src/app/(app)/policy/_data.ts`
- **Fix steps:**
  1. Get the predicate schema from policy-service, define a zod type replacing unknown[] in _data.ts.
  2. Add a 'Conditions' column (or expandable row) rendering each predicate as 'attribute operator value'; fall back to JSON in <details> for unknown shapes.
  3. Highlight deny rules with conditions in the row.
- **Acceptance:**
  - Rule with 2 predicates shows both in the table.
  - Rule with none shows 'Applies to all'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Access-control visibility; wrong rendering of predicates could mislead admins.
- **Depends on:** GAP-POLICY-ABAC-02

### GAP-POLICY-ABAC-02  ·  HIGH  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Allow and deny render identically: StatusPill has no "allow"/"deny" entry so both fall back to the blue "info" pill (StatusPill.tsx:52-53); the only cue is the word, in a page whose purpose is spotting deny rules.
- **Verified evidence:** apps/web/src/app/_components/ds/StatusPill.tsx:6-49 STATUS_MAP has no 'allow', 'deny' (or 'revoked') keys; line 53 falls back to 'info', so both Effect values render as the same blue pill (apps/web/src/app/(app)/policy/abac/page.tsx:55). Label is humanized text so the words differ, but no colour/icon distinction.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/policy/abac/page.tsx`
- **Fix steps:**
  1. Add allow:'good', deny:'bad', revoked:'bad' (and effect variants) to STATUS_MAP in StatusPill.tsx.
  2. Add a non-colour cue (icon/prefix) for deny.
  3. Add a StatusPill unit test for these keys.
- **Acceptance:**
  - StatusPill status='deny' has class pill bad; 'allow' pill good.
  - ABAC page shows red Deny.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component change alters other pages that pass 'allow'/'deny'/'revoked' (currently blue); verify.

### GAP-POLICY-ABAC-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Role and Id columns print raw UUIDs in <code> (page.tsx:63-64): role names are not resolved although /platform-admin/roles has them.
- **Verified evidence:** apps/web/src/app/(app)/policy/abac/page.tsx:56 `<code>{r.roleId}</code>` and :58 `<code>{r.id}</code>` print raw UUIDs. Role names are available from getAdminRoles() (loaders.ts, /api/policy/roles) which platform-admin/roles uses.
- **Files to change:** `apps/web/src/app/(app)/policy/abac/page.tsx`, `apps/web/src/app/(app)/policy/_data.ts`
- **Fix steps:**
  1. Load getAdminRoles() in page.tsx, build Map<id,name>, render name with id in a title/copy affordance.
  2. Drop or shrink the Id column (show short id with Copy).
  3. Fallback to id if role unresolved.
- **Acceptance:**
  - Rule shows role name.
  - Unknown role id falls back to short id.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-POLICY-ABAC-04  ·  MEDIUM  ·  partly  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle exposes an API path to end users ("loaded from /api/v1/policy/abac/rules", page.tsx:22); no create/edit/enable control, so "Enabled" cannot be changed anywhere in the UI.
- **Verified evidence:** Subtitle at apps/web/src/app/(app)/policy/abac/page.tsx:18 does expose '/api/v1/policy/abac/rules' (confirmed copy issue). The page is read-only (no create/edit/toggle), so 'Enabled' cannot be changed in UI (confirmed) - but that is missing scope, not a wiring bug; policy write endpoints are cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/policy/abac/page.tsx`
- **Fix steps:**
  1. Replace subtitle with 'Attribute-based access rules that allow or deny actions on resources.'
  2. Decide with product whether rule editing is in scope; if so add enable toggle with ConfirmDialog+reason and audit; else label page 'Read-only view'.
- **Acceptance:**
  - Subtitle contains no '/api/' text.
  - Page states it is read-only.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low for copy; editing is high risk (access control).

### GAP-POLICY-ABAC-05  ·  LOW  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Wrapper carries aria-label="ABAC rules" on a plain div with no role (page.tsx:18), which screen readers ignore; table container is role="region" with its own label (page.tsx:41).
- **Verified evidence:** apps/web/src/app/(app)/policy/abac/page.tsx:15 puts aria-label on a generic div (no role) which AT ignores/axe flags; table region has its own label at :38.
- **Files to change:** `apps/web/src/app/(app)/policy/abac/page.tsx`, `apps/web/src/app/(app)/policy/bindings/page.tsx`
- **Fix steps:**
  1. Remove aria-label from the wrapper div (same on bindings/page.tsx:16) or use <main aria-labelledby> with PageHeader heading id.
  2. Keep region label on the table.
- **Acceptance:**
  - axe: no aria-prohibited-attr on wrapper.
  - Page has one named landmark.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /policy/bindings  —  `policy/bindings.html`

- **Source:** `apps/web/src/app/(app)/policy/bindings/page.tsx`
- **Design reference:** `redesign/policy/bindings.html`

### GAP-POLICY-BINDINGS-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Privilege grant with no confirmation, no reason and no audit reference: submitting two UUIDs immediately POSTs (BindingCreateForm.tsx:17-40) and answers "Accepted (202)" — a role can be bound to any user id, including the requester's own.
- **Verified evidence:** apps/web/src/app/(app)/policy/bindings/BindingCreateForm.tsx:14-32 onSubmit POSTs {userId,roleId} to /api/proxy/v1/policy/bindings straight away; success message 'Accepted (202)' or 'Accepted — id ...' (apps/web/src/app/(app)/policy/bindings/BindingCreateForm.tsx:31). No ConfirmDialog, no reason, no self-grant check, no audit ref, page has no role gate (bindings/page.tsx). Server-side checks (SoD, self-grant, audit) are cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/policy/bindings/BindingCreateForm.tsx`, `apps/web/src/app/(app)/policy/bindings/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. Gate /policy/* via layout.tsx requireAnyRole (policy admin roles).
  2. Wrap submit in ConfirmDialog with requireReason showing resolved user and role names; send reason in body if API accepts.
  3. Block/flag when userId === current user (getSessionUserId, see USERS-03).
  4. Show returned binding id and link to audit-log; ask backend for maker-checker on privileged roles.
- **Acceptance:**
  - Non-admin cannot open /policy/bindings.
  - Submit opens confirm needing a reason.
  - Granting to self is refused.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Privilege escalation path; approvals/SoD.
- **Depends on:** GAP-PLATFORM-ADMIN-USERS-03

### GAP-POLICY-BINDINGS-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Users must paste raw UUIDs for both user and role (BindingCreateForm.tsx:47-63) and the list prints the same UUIDs in <code> (page.tsx:60-61); no names, no lookup, and the pattern [0-9a-fA-F-]{36} accepts non-UUID strings such as 36 hyphens.
- **Verified evidence:** apps/web/src/app/(app)/policy/bindings/BindingCreateForm.tsx:46-64 two free-text UUID inputs with pattern="[0-9a-fA-F-]{36}", which accepts 36 hyphens; list prints userId/roleId/id in <code> (apps/web/src/app/(app)/policy/bindings/page.tsx:56-59). No EntityPicker exists in ds (verified listing).
- **Files to change:** `apps/web/src/app/(app)/policy/bindings/BindingCreateForm.tsx`, `apps/web/src/app/(app)/policy/bindings/page.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx`
- **Fix steps:**
  1. Create ds/EntityPicker (async search combobox) for users (getAdminUsersList) and roles (getAdminRoles).
  2. Replace both inputs; submit ids from the selection.
  3. Zod uuid() validation as fallback.
  4. In the table resolve names via loaders; keep ids as secondary text.
- **Acceptance:**
  - Cannot submit without picking both.
  - Table shows names.
  - Pattern accepting '------' is gone.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; shared component reused elsewhere.

### GAP-POLICY-BINDINGS-04  ·  MEDIUM  ·  partly  ·  theme STATE (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** After a successful create the list is not refreshed (no router.refresh in BindingCreateForm.tsx:31-38), and the form is cleared, so the new binding does not appear and the admin cannot tell it worked beyond the message.
- **Verified evidence:** Confirmed: BindingCreateForm.tsx:30-35 clears fields, never calls router.refresh(); page is force-dynamic but has revalidateSeconds 30 in getPolicyBindings so the list will not show the new row immediately. Message 'Accepted' is shown, so it is not silent. 202 implies async processing, so the row may legitimately not exist yet. Theme DEADROUTE incorrect.
- **Files to change:** `apps/web/src/app/(app)/policy/bindings/BindingCreateForm.tsx`
- **Fix steps:**
  1. useRouter().refresh() after success (and consider revalidating the fetch tag).
  2. Message: 'Request accepted; the binding appears once processed' with a Refresh button if 202.
  3. Focus the status message.
- **Acceptance:**
  - After create, list refetched.
  - 202 case explains delay.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-POLICY-BINDINGS-05  ·  MEDIUM  ·  partly  ·  theme STATUS (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** No revoke action exists although the table and stat card show a Revoked status; "revoked" has no StatusPill mapping so it renders as blue "info" (StatusPill.tsx:52-53). Forms use bare <label><span> markup and an unstyled submit button.
- **Verified evidence:** True: no revoke control; page shows Revoked stat (apps/web/src/app/(app)/policy/bindings/page.tsx:12,23) and 'revoked' is not in STATUS_MAP so falls to info (apps/web/src/app/_components/ds/StatusPill.tsx:53). True: form uses bare <label><span> and a plain <button> (BindingCreateForm.tsx:44-73). Theme PII is wrong. Revoke endpoint is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/policy/bindings/page.tsx`, `apps/web/src/app/(app)/policy/bindings/BindingCreateForm.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add revoked:'bad' (or 'mut') to STATUS_MAP.
  2. Add Revoke row action (ConfirmDialog+reason) once backend endpoint confirmed.
  3. Use ds Button and shared form field components in the form.
- **Acceptance:**
  - Revoked pill not blue.
  - Revoke confirms and status changes after refresh.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Revoking removes access; needs reason and audit.
- **Depends on:** GAP-POLICY-ABAC-02


---
## /policy/evaluate  —  `policy/evaluate.html`

- **Source:** `apps/web/src/app/(app)/policy/evaluate/page.tsx`
- **Design reference:** `redesign/policy/evaluate.html`

### GAP-POLICY-EVALUATE-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Cannot evaluate anyone but yourself: the principal comes from the JWT and only permissionKey + resource are sent (EvaluateForm.tsx:26-27,55), so an admin cannot check why a user was denied — the page named "Evaluate Permission" under Policy admin answers only "what can I do".
- **Verified evidence:** EvaluateForm.tsx:52 posts only {permissionKey, resource}; header comment (l.16) states principal is derived server-side from the JWT. No user/role picker exists, so the page tests only the caller's own permissions. Whether policy-service accepts a subject/principal override cannot be seen (services/ holds only hrms-service).
- **Files to change:** `apps/web/src/app/(app)/policy/evaluate/EvaluateForm.tsx`, `apps/web/src/app/(app)/policy/evaluate/page.tsx`
- **Fix steps:**
  1. Confirm with policy-service owner whether POST /v1/policy/evaluate can take an optional subjectUserId (admin-only, audited); if not, add it there first.
  2. Add an optional 'Evaluate as user' field to EvaluateForm using the existing user EntityPicker/lookup; default to 'Me'.
  3. Send subjectUserId only when set; show 'Evaluated for: <name>' in the result panel.
  4. Hide the picker unless the caller holds the policy-admin permission; server must re-check it.
  5. Retitle subtitle to 'Check why a user is allowed or denied'.
- **Acceptance:**
  - Unit: with picker empty, body has no subjectUserId; with a user selected, body includes it.
  - Manual: admin selects user X and a key X lacks; result shows deny for X, not for admin.
  - Non-admin does not see the picker; a crafted request is rejected 403 by the server.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Impersonation-style evaluation exposes another user's access profile; must be admin-only and produce an audit event.

### GAP-POLICY-EVALUATE-02  ·  MEDIUM  ·  partly  ·  theme UX (was UUID)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Result is raw: decision string, free-text reason and matchedRuleId UUID (EvaluateForm.tsx:105-118); no allow/deny colouring and no link to the matched rule on /policy/abac.
- **Verified evidence:** Result panel is EvaluateForm.tsx:100-114 (obs said 105-118). It prints decision, reason and matchedRuleId in <code> as plain text: no allow/deny styling and no link. /policy/abac (abac/page.tsx) lists rules with id in <code> but has no row anchors or ?rule= handling, so a link needs an anchor added there too.
- **Files to change:** `apps/web/src/app/(app)/policy/evaluate/EvaluateForm.tsx`, `apps/web/src/app/(app)/policy/abac/page.tsx`
- **Fix steps:**
  1. Render decision with <StatusPill> (allow -> good, deny -> bad; add 'allow'/'deny' to STATUS_MAP in ds/StatusPill.tsx if absent).
  2. Show reason as normal text; drop the raw UUID label 'Matched rule' in favour of a Link to /policy/abac#rule-<id>.
  3. In abac/page.tsx add id={`rule-${r.id}`} on each <tr> (and highlight :target).
  4. Keep the UUID only as a small copyable secondary detail.
- **Acceptance:**
  - Component test: decision 'allow' renders good pill, 'deny' renders bad pill.
  - Test: matchedRuleId present -> link href '/policy/abac#rule-<id>'; absent -> no link.
  - Manual: click link, ABAC page scrolls to the row.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; ensure colour is not the only cue (pill carries text).

### GAP-POLICY-EVALUATE-03  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Server failures use formError.fromResponse(res, "save") (EvaluateForm.tsx:62) so a failed evaluation says it could not save; the subtitle exposes the endpoint path (page.tsx:15).
- **Verified evidence:** EvaluateForm.tsx:56 (obs said 62) calls formError.fromResponse(res,"save") and :64 fromException("save"); useFormError.ts:106-108 uses that kind unless the code maps to another, and messages.ts renders "We couldn't save your policy evaluation." for a read-only evaluate call. page.tsx:11 (obs said 15) subtitle literally says "Run a decision against /api/v1/policy/evaluate (RBAC + ABAC)." Same exposed-path subtitle exists on abac and role-features pages.
- **Files to change:** `apps/web/src/app/(app)/policy/evaluate/EvaluateForm.tsx`, `apps/web/src/app/(app)/policy/evaluate/page.tsx`, `apps/web/src/app/(app)/policy/abac/page.tsx`, `apps/web/src/app/(app)/policy/role-features/page.tsx`, `apps/web/src/lib/messages.ts`
- **Fix steps:**
  1. Pass "load" (or add a new MessageKind 'evaluate' in messages.ts: "We couldn't run the permission check.") in both fromResponse and fromException calls.
  2. Change the useFormError area label to 'permission check'.
  3. Reword subtitles on evaluate/abac/role-features to plain language (e.g. 'Check whether a permission is allowed and which rule decided it') with no API path.
- **Acceptance:**
  - Component test: mock 500 -> message does not contain 'save'.
  - Grep the three policy pages: no '/api/v1' string in rendered subtitles.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None; copy only.

### GAP-POLICY-EVALUATE-04  ·  MEDIUM  ·  partly  ·  theme A11Y (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Result panel is only role="status"; the previous result is cleared on submit (EvaluateForm.tsx:33) so re-runs blink; textarea and input lack helper text for the key format service.resource.action beyond the placeholder.
- **Verified evidence:** setResult(null) is at EvaluateForm.tsx:30 (obs said 33), so the prior result vanishes on each run; the result div (l.101) has role="status" aria-live="polite" which is adequate. The key input (l.72-78) has only a placeholder 'service.resource.action' and no helper text; the textarea has no example. Theme FABRICATED is wrong - nothing is fabricated.
- **Files to change:** `apps/web/src/app/(app)/policy/evaluate/EvaluateForm.tsx`
- **Fix steps:**
  1. Remove setResult(null) at submit; instead dim the panel (aria-busy) while status==='pending' and replace on success.
  2. Add helper text under the key input ('Format: service.resource.action, e.g. finance.journal.create').
  3. Add example JSON hint under the textarea ({"department":"IT"}).
  4. Show inline field-level error for invalid JSON next to the textarea (aria-describedby).
- **Acceptance:**
  - Manual: run twice; previous result stays visible (dimmed) until new one arrives.
  - Screen-reader check: helper text is announced via aria-describedby.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /policy/role-features  —  `policy/role-features.html`

- **Source:** `apps/web/src/app/(app)/policy/role-features/page.tsx`
- **Design reference:** `redesign/policy/role-features.html`

### GAP-POLICY-ROLE-FEATURES-01  ·  HIGH  ·  confirmed  ·  theme MISSING-ACTION (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Grant-only: the form always sends granted: true (RoleFeatureGrantForm.tsx:22) and the table has no action column, so a "revoked" row (page.tsx:61-63) can be produced by nobody in the UI, and a wrongly granted feature cannot be undone here.
- **Verified evidence:** RoleFeatureGrantForm.tsx:22 hard-codes granted:true; the table (page.tsx:46-64) has columns Role, Feature, Granted, Id and no action column. Rows with granted=false only arise from other clients. Whether the API supports PATCH/DELETE for a grant is not visible (no policy-service in snapshot).
- **Files to change:** `apps/web/src/app/(app)/policy/role-features/page.tsx`, `apps/web/src/app/(app)/policy/role-features/RoleFeatureGrantForm.tsx`, `apps/web/src/app/(app)/policy/role-features/GrantRowActions.tsx (new)`
- **Fix steps:**
  1. Confirm backend contract for revoke (POST same endpoint with granted:false, or PATCH by id with version).
  2. Create GrantRowActions client component with Revoke/Restore button using <ConfirmDialog> (requireReason).
  3. Add an Actions column in page.tsx rendering it per row; on success call router.refresh().
  4. Send the row's `version` for optimistic concurrency (RoleFeatureGrantRow has version?).
- **Acceptance:**
  - Component test: Revoke posts granted:false for that row and refreshes.
  - Manual: revoked row shows 'revoked' pill and a Restore action.
  - Confirm dialog cancel sends nothing.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Changes who sees which features; a wrong revoke hides UI from a whole role - needs confirm and audit.
- **Depends on:** GAP-POLICY-ROLE-FEATURES-04

### GAP-POLICY-ROLE-FEATURES-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Pre-filled defaults are live values: role "finance_clerk" and feature "finance.dashboard" (RoleFeatureGrantForm.tsx:9-10), so pressing Grant feature immediately grants finance visibility with no confirmation, reason or audit reference.
- **Verified evidence:** RoleFeatureGrantForm.tsx:8-9 (obs said 9-10) initial state roleName='finance_clerk', featureKey='finance.dashboard'; submit (l.14-23) posts immediately with no ConfirmDialog. No reason field is sent; audit emission is server-side and cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/policy/role-features/RoleFeatureGrantForm.tsx`
- **Fix steps:**
  1. Initialise both fields to ''; keep placeholders as examples only.
  2. Disable submit until both non-empty (trimmed).
  3. Wrap submit in <ConfirmDialog> stating 'Grant <feature> to <role>?'.
  4. If backend accepts a reason, add optional reason input; otherwise raise with backend owners.
- **Acceptance:**
  - Test: fresh render has empty fields and disabled button.
  - Test: clicking Grant opens confirm; no fetch until confirmed.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Removes an accidental one-click grant of finance visibility.
- **Depends on:** GAP-POLICY-ROLE-FEATURES-03

### GAP-POLICY-ROLE-FEATURES-03  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Free-text role and feature keys (maxLength 100/200) with no validation against the role catalogue or known features, so a typo creates a dangling grant; the list shows the raw key in <code> (page.tsx:60).
- **Verified evidence:** RoleFeatureGrantForm.tsx:42,46 are plain text inputs with maxLength 100/200 and only `required`; list shows g.featureKey in <code> (page.tsx:57, obs said 60). No lookup of the role catalogue. Roles exist at /tenant-admin/roles; a feature-key catalogue endpoint is not visible in web code or snapshot.
- **Files to change:** `apps/web/src/app/(app)/policy/role-features/RoleFeatureGrantForm.tsx`, `apps/web/src/app/(app)/policy/role-features/page.tsx`, `apps/web/src/app/(app)/policy/_data.ts`
- **Fix steps:**
  1. Replace Role name with a select fed by the roles list already used by /tenant-admin/roles (add getRoles to _data.ts by reusing that loader).
  2. Feature key: select from a catalogue if backend exposes one; otherwise validate against pattern ^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$ and warn on unknown.
  3. Show friendly feature label with key secondary in the table.
  4. Server must reject unknown role/feature (zod + lookup) - raise with backend.
- **Acceptance:**
  - Test: free-typed unknown role cannot be submitted.
  - Manual: typo in feature key shows inline error.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Dangling grants are silent; catalogue source of truth for features needs a decision.
- **Depends on:** GAP-POLICY-ROLE-FEATURES-02

### GAP-POLICY-ROLE-FEATURES-04  ·  MEDIUM  ·  partly  ·  theme WIRING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** List is not refreshed after a successful grant (no router.refresh, RoleFeatureGrantForm.tsx:24-31), and form fields are not cleared, so an accidental double-click submits twice.
- **Verified evidence:** True: no router.refresh() after success (l.29-31) and fields are kept, and the success message is 'Accepted (202)', implying async processing so the list may lag. Overstated: submit button is disabled while status==='pending' (l.48), so a double-click in flight is blocked; a repeat only occurs after completion.
- **Files to change:** `apps/web/src/app/(app)/policy/role-features/RoleFeatureGrantForm.tsx`
- **Fix steps:**
  1. Import useRouter; call router.refresh() after a successful response.
  2. Clear (or reset) fields after success.
  3. Replace 'Accepted (202)' message with 'Grant submitted - it may take a moment to appear' plus visible refresh.
  4. Optionally keep button disabled for 1s after success.
- **Acceptance:**
  - Test: successful POST triggers router.refresh once.
  - Manual: after grant the new row appears without full reload (or after refresh, if async).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-POLICY-ROLE-FEATURES-01

### GAP-POLICY-ROLE-FEATURES-05  ·  LOW  ·  partly  ·  theme LABELS (was I18N)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Roles stat counts distinct roleName strings (page.tsx:15) and the page mixes "granted"/"revoked" wording with the Enabled/Active pill vocabulary used on ABAC.
- **Verified evidence:** page.tsx:13 (obs said 15) counts distinct roleName strings - accurate but labelled 'Roles' rather than 'Roles with grants'. Table pill uses StatusPill status active/inactive with label granted/revoked (l.59) whereas abac/page.tsx:63 uses the default humanised Active/Inactive: wording differs but is a minor consistency issue, not i18n.
- **Files to change:** `apps/web/src/app/(app)/policy/role-features/page.tsx`, `apps/web/src/app/(app)/policy/abac/page.tsx`
- **Fix steps:**
  1. Rename stat label to 'Roles with grants'.
  2. Pick one vocabulary (Granted/Revoked) and use it for the column header, stat and pill; use Enabled/Disabled on ABAC consistently.
- **Acceptance:**
  - Manual: wording consistent across the two pages.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## Backend verification items (service code absent from snapshot)

### GAP-POLICY-HOME-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (Verified on main e64260031 (UAT B1/B2): apps/web/src/app/(app)/policy/layout.tsx (POLICY_ADMIN_ROLES) + services/policy-service/src/modules/bindings/routes.ts:10,58-61 (ADMIN role gate, SELF_BINDING_FORBIDDEN) and role-features (all 5 routes requireRole); test comp-007-bindings-smoke.test.ts (403 non-admin, self-binding 403, grant/revoke audit))
- **First-pass claim:** No gate on a module that edits authorisation: policy/ has no layout.tsx, ModuleGate or requireAnyRole, so any signed-in user reaches Bindings (grant role to any user id) and Role Features. Server-side enforcement undeterminable (policy-service absent).
- **Service:** `policy-service`  ·  **Endpoint(s):** `['POST /api/v1/policy/bindings', 'role features endpoints']`
- **Question:** Binding creation must require a policy/tenant admin role and forbid self-escalation (granting oneself a higher role); audit each grant.
- **How to verify:** Open policy-service bindings POST; curl as employee granting own id role tenant_admin expecting 403.
- **Test to add:** Given employee JWT, when POST bindings for own id, then 403; admin grants emit audit.
- **Impact if wrong:** Privilege escalation by any signed-in user.
- **Web change if wrong:** Add policy/layout.tsx requireAnyRole gate.

### GAP-POLICY-BINDINGS-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (Verified on main e64260031 (UAT B1/B2): services/policy-service/src/modules/bindings/routes.ts:36-45 (GET list, admin-gated, tenant-scoped, {data,limit,offset,count,total}); test comp-007-bindings-smoke.test.ts (list, pagination, cross-tenant invisibility))
- **First-pass claim:** List depends on an endpoint the loader comment says may not exist ("GET is attempted for F1 wiring", _data.ts:36) — a 404 would surface as the error state on every load. Undeterminable: policy-service is not in the snapshot.
- **Service:** `policy-service`  ·  **Endpoint(s):** `['GET /api/v1/policy/bindings', 'POST /api/v1/policy/bindings']`
- **Question:** GET /v1/policy/bindings must exist and return the documented list shape; a 404 must not occur.
- **How to verify:** Grep policy-service routes for 'bindings' GET; curl GET with admin token expecting 200 array.
- **Test to add:** Given admin JWT, when GET policy/bindings, then 200 with array of {id,userId,role,status}.
- **Impact if wrong:** Bindings page permanently shows error state.
- **Web change if wrong:** If absent: implement GET server-side; else web should show empty state on 404.

### GAP-POLICY-EVALUATE-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
  Closed by 9fe523231 (UAT B2): evaluate now writes the decision (permission, subject, decision, onBehalfOf) to audit.event.record in the same txn; tests/gap-policy-evaluate-05-audit.test.ts.
- **First-pass claim:** Evaluate is a POST but has no audit note; if evaluation decisions are audited server-side that is undeterminable here (policy-service absent).
- **Service:** `policy-service`  ·  **Endpoint(s):** `['POST /api/v1/policy/evaluate']`
- **Question:** Does evaluate emit an audit/decision-log event, and is it restricted to policy admins?
- **How to verify:** Open the evaluate handler; grep for audit emission. Call and inspect audit stream.
- **Test to add:** Given admin JWT, when POST evaluate, then a decision-log event with subject, action, decision is recorded.
- **Impact if wrong:** Authorisation probing untraceable.
- **Web change if wrong:** Add an audit note to the page only if server does not log.
