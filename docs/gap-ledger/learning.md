# Detailed gap file — module `learning`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 46



---
## /learning  —  `learning/home.html`

- **Source:** `apps/web/src/app/(app)/learning/page.tsx`
- **Design reference:** `redesign/learning/home.html`

### GAP-LEARNING-HOME-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W1 SF-16: closed by #2004)
- **W0-10 note:** review found the W0 tick partly — Web passes own employee id (learning/page.tsx) and bare employee is scoped server-side (routes.ts:247-251), but backend still lets "manager" omit employeeId for tenant-wide totals (routes.ts:245) contrary to "only HR"; web falls back to tenant totals when profile id missing (myId undefined)
- **First-pass claim:** "Enrolled / In Progress / Completed / Overdue" are tenant-wide counts: getLmsDashboard() is called with no employeeId (page.tsx:12) and the endpoint aggregates every enrolment in the tenant (learning/routes.ts:199-215). They sit next to My Learning links and read as personal progress.
- **Verified evidence:** learning/page.tsx:12 calls getLmsDashboard() with no employeeId; endpoint (learning/routes.ts:199-215) scopes to employee only if ?employeeId is given, else counts every enrolment in tenant (countEnrollmentsByStatus). Cards labelled Enrolled/In Progress/Completed/Overdue and all link to My Learning (page.tsx:47-58 in file numbering). Any employee sees tenant totals; also employeeId param unscoped server-side.
- **Files to change:** `apps/web/src/app/(app)/learning/page.tsx`, `services/hrms-service/src/modules/learning/routes.ts`
- **Fix steps:**
  1. Pass session employee id: getLmsDashboard(myEmployee.id) for personal cards.
  2. Backend: apply the self-scope helper to /learning/dashboard; only HR may omit employeeId for tenant totals.
  3. If tenant totals are wanted for HR, label them 'Organisation' and show separately.
- **Acceptance:**
  - Employee sees own counts (matches My Learning).
  - Employee GET dashboard without employeeId returns own counts / 403, not tenant totals.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Information exposure of aggregate counts; low PII but wrong figures.
- **Depends on:** GAP-LEARNING-COURSES-DETAIL-02

### GAP-LEARNING-HOME-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** All four stat cards link to /learning/my-learning, which renders "Select an employee" unless ?employeeId=<uuid> is typed (my-learning/page.tsx:11-16): the primary path from home to the user’s own progress dead-ends.
- **Verified evidence:** All four StatCards wrap Link to /learning/my-learning without employeeId (learning/page.tsx:47-58); my-learning/page.tsx:11-16 shows 'Select an employee' EmptyState unless ?employeeId present.
- **Files to change:** `apps/web/src/app/(app)/learning/my-learning/page.tsx`, `apps/web/src/app/(app)/learning/page.tsx`, `apps/web/src/app/(app)/learning/_data.ts`
- **Fix steps:**
  1. In my-learning use getMyProfile().id when no query; keep override for HR only.
  2. Optionally add status filter param from each card (?status=overdue).
  3. Replace EmptyState with no-employee-record message when profile is 404.
- **Acceptance:**
  - Click Enrolled card as an employee: own enrolments list appears with no query.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-LEARNING-CALENDAR-01

### GAP-LEARNING-HOME-03  ·  MEDIUM  ·  partly  ·  theme ROLEGATE (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Catalogue lists every course including drafts: listCourses filters only tenant and search (learning/repo.ts:22-31), but the page copy says "published courses" (page.tsx:72).
- **Verified evidence:** Catalogue includes drafts because listCourses has no status filter (repo.ts:22-31); home table shows Status column and copy says 'No courses published yet' / 'Published courses...' (learning/page.tsx:72,78 in file numbering). Copy accuracy is the issue, not i18n; theme I18N wrong.
- **Files to change:** `apps/web/src/app/(app)/learning/page.tsx`, `services/hrms-service/src/modules/learning/repo.ts`
- **Fix steps:**
  1. Fix at source per COURSES-01 (published only for non-HR).
  2. Adjust copy to 'Course catalogue' if HR sees drafts.
- **Acceptance:**
  - Employee home shows only published courses.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-LEARNING-COURSES-01

### GAP-LEARNING-HOME-04  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** No role/module gating in the web tree (no learning/layout.tsx); a tenant with Learning disabled still serves these routes, unlike knowledge/layout.tsx which uses ModuleGate.
- **Verified evidence:** No learning/layout.tsx exists (ls of learning/: only _data.ts, loading.tsx, page.tsx and subfolders) whereas knowledge/layout.tsx wraps ModuleGate; hr/layout.tsx:46 uses moduleKey 'hrms'. Sidebar hides learning links via moduleKey 'hrms' (Sidebar.tsx:76-78) but direct URLs still serve. Backend hrms-service still enforces roles; module entitlement at API not verified.
- **Files to change:** `apps/web/src/app/(app)/learning/layout.tsx`
- **Fix steps:**
  1. Create learning/layout.tsx returning <ModuleGate moduleKey="hrms">{children}</ModuleGate> (import from ../ModuleGate).
  2. Verify module key name in tenant nav-modules list.
- **Acceptance:**
  - Tenant with HRMS disabled sees Module Not Enabled at /learning.
  - Enabled tenant unaffected.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; wrong key would block everyone - test lenient match.

### GAP-LEARNING-HOME-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Tile "values" are sentences ("Sessions & nominations") rendered in the large StatCard value slot (page.tsx:61-64); no counts on those tiles.
- **Verified evidence:** Navigation tiles use StatCard value='Sessions & nominations' etc. (learning/page.tsx:61-64 -> lines 210-213), sentences in the big value slot; no counts.
- **Files to change:** `apps/web/src/app/(app)/learning/page.tsx`
- **Fix steps:**
  1. Replace with a link-card/ Card component with title + description, or feed real counts (e.g. upcoming sessions, open plans).
  2. Keep Link wrapper with focus style.
- **Acceptance:**
  - Tiles show consistent hierarchy; keyboard focus visible.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-LEARNING-HOME-06  ·  LOW  ·  partly  ·  theme STYLE (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx uses hard-coded tailwind gray-100/200 blocks (loading.tsx:4-9), not DS skeletons.
- **Verified evidence:** learning/loading.tsx:4-9 uses Tailwind bg-gray-100/200 animate-pulse blocks. True, but other loading files may follow same pattern; whether a DS skeleton exists was not found in ds/index.ts export list viewed. Not a fabricated-data issue; theme FABRICATED wrong.
- **Files to change:** `apps/web/src/app/(app)/learning/loading.tsx`
- **Fix steps:**
  1. Check ds for a Skeleton component; if none create one in ds and replace the gray classes with theme tokens (var(--panel)).
  2. Apply to all learning/*/loading.tsx.
- **Acceptance:**
  - Loading state respects dark/theme tokens.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /learning/assessments  —  `learning/assessments.html`

- **Source:** `apps/web/src/app/(app)/learning/assessments/page.tsx`
- **Design reference:** `redesign/learning/assessments.html`

### GAP-LEARNING-ASSESSMENTS-01  ·  HIGH  ·  partly  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** The page promises "assessments you can attempt" and "Take & verify" on home, but no row action or attempt route exists in apps/web (learning/ has no attempt page); the server endpoints for attempts (assessment/routes.ts:180,227) are unused, so the list is a dead end.
- **Verified evidence:** apps/web/src/app/(app)/learning/assessments/page.tsx:20 copy says 'assessments you can attempt' and the empty state at :29 says the same; rows (:11-14, DataTable :31-44) have no action/link and no attempt route exists under learning/ (dirs: assessments, calendar, competency, courses, my-learning, training-plans). Backend endpoints POST /v1/hrms/assessments/:id/attempts (routes.ts:180) and submit (:227) exist. 'Take & verify' on home not checked.
- **Files to change:** `apps/web/src/app/(app)/learning/assessments/page.tsx`, `(new) apps/web/src/app/(app)/learning/assessments/[id]/page.tsx`, `(new) apps/web/src/app/(app)/learning/assessments/[id]/AttemptClient.tsx`, `apps/web/src/app/(app)/learning/_data.ts`
- **Fix steps:**
  1. Add an attempt route wired to POST attempts then POST submit, using a zod-validated request.
  2. Add row link (rowHref) for published assessments.
  3. Interim: rewrite subtitle to not promise attempting.
- **Acceptance:**
  - Employee can start and submit an attempt and sees score/pass.
  - Attempt limit error (409 ATTEMPT_LIMIT) is shown.
- **Needs:** web  ·  **Effort:** L >2d  ·  **Risk:** Medium: assessment-taking needs question delivery endpoint; a question fetch route was not seen (cannot-verify).
- **Depends on:** GAP-LEARNING-ASSESSMENTS-02

### GAP-LEARNING-ASSESSMENTS-02  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Every assessment status is returned to every role: listAssessments filters only tenant (assessment/repo.ts:51-54) and the route allows ALL_ROLES (assessment/routes.ts:66-70), so draft and pending_approval assessments appear under "Published assessments" (page.tsx:20).
- **Verified evidence:** services/hrms-service/src/modules/assessment/repo.ts listAssessments filters only tenantId (limit 100); routes.ts:66-70 allows ALL_ROLES (includes employee); apps/web/src/app/(app)/learning/assessments/page.tsx:9-14 maps all statuses with no filter, headline says 'Published assessments' (:20). Status column shows it, so it is not hidden but wrong for learners.
- **Files to change:** `services/hrms-service/src/modules/assessment/repo.ts`, `services/hrms-service/src/modules/assessment/routes.ts`, `apps/web/src/app/(app)/learning/assessments/page.tsx`
- **Fix steps:**
  1. Backend: in the route, if caller is not in HR_ROLES pass status 'published' filter to listAssessments.
  2. Web: filter a.status==='published' in page.tsx for the learner view (defence in depth).
  3. Consider an HR view with all statuses.
- **Acceptance:**
  - Employee token gets only published rows from API.
  - Learner page never lists draft.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; draft content should not be exposed to all staff.

### GAP-LEARNING-ASSESSMENTS-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Rows are not links and there is no detail (duration, question count, related course) though courseRef is loaded (_data.ts:71) and unused.
- **Verified evidence:** learning/_data.ts:71 Assessment type includes courseRef; page.tsx:11-14 drops it; DataTable has no row link. Question count not present in the type (cannot-verify from API).
- **Files to change:** `apps/web/src/app/(app)/learning/assessments/page.tsx`
- **Fix steps:**
  1. Add a Course column (or link to /learning/courses/{courseRef}) if courseRef is a course id (verify).
  2. Add rowHref to a detail page once ASSESSMENTS-01 route exists.
- **Acceptance:**
  - Rows with courseRef show a course link.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-LEARNING-ASSESSMENTS-01

### GAP-LEARNING-ASSESSMENTS-04  ·  LOW  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Passing score prints a bare number (page.tsx:12) — no % or marks unit; attempts used by the signed-in employee are not shown against Max attempts.
- **Verified evidence:** apps/web/src/app/(app)/learning/assessments/page.tsx:12 passing: `${a.passingScore}` prints bare value (string type, _data.ts:71); no attempts-used data is fetched anywhere on the page. Unit (percent vs marks) is unknown; attempt counts would need a per-employee endpoint (only POST attempts and GET attempts/:id seen).
- **Files to change:** `apps/web/src/app/(app)/learning/assessments/page.tsx`
- **Fix steps:**
  1. Confirm whether passingScore is a percent; if so append '%'.
  2. For attempts used, needs a list-attempts-by-employee endpoint (backend) before showing 'x of maxAttempts'.
- **Acceptance:**
  - Passing score displays with unit.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /learning/assessments/verify  —  `learning/assessments-verify.html`

- **Source:** `apps/web/src/app/(app)/learning/assessments/verify/page.tsx`
- **Design reference:** `redesign/learning/assessments-verify.html`

### GAP-LEARNING-ASSESSMENTS-VERIFY-01  ·  HIGH  ·  partly  ·  theme PII

- [x] **Status** (W0 2026-10-13: closed by #1916; re-confirmed in W1 SF-16, #2004)
- **First-pass claim:** Verification discloses employeeId and assessmentId (raw UUIDs) to any authenticated user holding a token (page.tsx:51-52; assessment/routes.ts:288-296) — no masking or role limit (DPDP); no rate limit is visible in the route, only a 8–64 character token length.
- **Verified evidence:** apps/web/src/app/(app)/learning/assessments/verify/page.tsx:51-52 prints cert.employeeId and cert.assessmentId; routes.ts:277-292 returns them for any caller with ALL_ROLES (includes employee, routes.ts:20). Token length 8-64 only (:280). repo.getCertificateByToken(token) takes no tenantId (:281), so a token resolves across tenants. Rate limiting is not visible in the route (may exist globally, cannot-verify). The IDs are UUIDs, not names, so the PII severity is moderate, but they link a person to a certificate.
- **Files to change:** `services/hrms-service/src/modules/assessment/routes.ts`, `services/hrms-service/src/modules/assessment/repo.ts`, `apps/web/src/app/(app)/learning/assessments/verify/page.tsx`
- **Fix steps:**
  1. Backend: pass ctx.tenantId to getCertificateByToken and add a tenant check; add per-IP/user rate limit.
  2. Backend: restrict employeeId disclosure to HR roles or the owner; for others return only certificateNo, status, issuedAt, validUntil and assessment title.
  3. Emit an audit event for each verification.
  4. Web: stop rendering raw UUIDs; show masked employee reference and assessment title (via <Masked> when created).
- **Acceptance:**
  - Employee role verifying someone else's token does not receive employeeId.
  - Token for another tenant returns 404.
  - Audit row created per lookup.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: verification is used to prove credentials; removing fields may break consumers of the endpoint.

### GAP-LEARNING-ASSESSMENTS-VERIFY-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** A malformed token (400) and a service outage are indistinguishable: both set source "error" and show only the "Couldn't load — showing nothing" badge (page.tsx:29; assessment/routes.ts:281). 404 is the only path that says "Certificate not found".
- **Verified evidence:** apps/web/src/app/(app)/learning/assessments/verify/page.tsx:29 shows DataSourceBadge for any source 'error'; 404 is also an error in fetchJson (apiClient.ts:144 returns status and errorCode), yet the page's 'Certificate not found' branch (:31-33) only runs when source!=='error', i.e. it appears unreachable on a real 404 (loader returns error, not api null). So a genuine 404 and 400/outage all show the badge.
- **Files to change:** `apps/web/src/app/(app)/learning/assessments/verify/page.tsx`
- **Fix steps:**
  1. Read result.status: if 404 render 'Certificate not found' EmptyState; if 400 or client-side length check fails show 'Invalid token format'; otherwise RefreshErrorState.
  2. Validate token length (8-64) client-side before calling.
- **Acceptance:**
  - 404 token shows Not found.
  - Short token shows format error.
  - Simulated 500 shows retry state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; verifier could misread outage as invalid certificate today.
- **Depends on:** RefreshErrorState

### GAP-LEARNING-ASSESSMENTS-VERIFY-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Route sits in the authenticated (app) group, so third parties (employers, auditors) who receive a certificate cannot verify it; a public verify page is not in the web tree.
- **Verified evidence:** Route is under apps/web/src/app/(app)/learning/assessments/verify/ (authenticated); middleware.ts:11 PUBLIC list contains only /auth, /api/auth, /api/careers, /careers etc. The backend also requires a role (routes.ts:279). No public verify page exists.
- **Files to change:** `apps/web/src/middleware.ts`, `(new) apps/web/src/app/verify/page.tsx`, `services/hrms-service/src/modules/assessment/routes.ts`
- **Fix steps:**
  1. Decision: confirm public verification is desired (privacy).
  2. Add public route /verify (outside (app)) and add to PUBLIC in middleware.ts.
  3. Add unauthenticated backend endpoint returning minimal fields, rate limited.
  4. Encode QR/link on certificates.
- **Acceptance:**
  - Unauthenticated visitor can verify a valid token and sees no employee ids.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** High: exposes data publicly; needs security review.
- **Depends on:** GAP-LEARNING-ASSESSMENTS-VERIFY-01

### GAP-LEARNING-ASSESSMENTS-VERIFY-04  ·  LOW  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Dates use new Date().toLocaleDateString("en-IN") (page.tsx:45-46) → "14/9/2026", inconsistent with formatIndianDate ("14 Sep 2026") used in knowledge pages; status shown raw ("active").
- **Verified evidence:** apps/web/src/app/(app)/learning/assessments/verify/page.tsx:45-46 use toLocaleDateString('en-IN') giving 'd/M/yyyy' (e.g. 14/9/2026) with no timezone; status shown raw (:42). But formatIndianDate (lib/formatters.ts:2-7) outputs 2-digit dd/MM/yyyy ('14/09/2026'), not '14 Sep 2026' as the finding says. Inconsistency is real, the example is wrong.
- **Files to change:** `apps/web/src/app/(app)/learning/assessments/verify/page.tsx`
- **Fix steps:**
  1. Import formatIndianDate from @/lib/formatters and use for issuedAt/validUntil.
  2. Map status to a label (Active/Expired/Revoked) and render a StatusPill.
- **Acceptance:**
  - Issued date shows 14/09/2026.
  - Status shows capitalised label.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-LEARNING-ASSESSMENTS-VERIFY-05  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** No loading.tsx for this segment (ls); the form is a plain GET so there is no pending indicator.
- **Verified evidence:** ls of apps/web/src/app/(app)/learning/assessments/verify shows only page.tsx (no loading.tsx), confirmed. However the parent assessments/loading.tsx exists and Next.js loading boundaries apply to nested segments, so a fallback does show on navigation; the form is a GET so the page re-renders with the parent skeleton. Impact is minor.
- **Files to change:** `apps/web/src/app/(app)/learning/assessments/verify/loading.tsx`
- **Fix steps:**
  1. Add a small loading.tsx matching the form + stat grid shape (optional).
  2. Optionally disable the Verify button while pending via a client form component.
- **Acceptance:**
  - Submitting a token shows a skeleton while fetching.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /learning/calendar  —  `learning/calendar.html`

- **Source:** `apps/web/src/app/(app)/learning/calendar/page.tsx`
- **Design reference:** `redesign/learning/calendar.html`

### GAP-LEARNING-CALENDAR-01  ·  HIGH  ·  partly  ·  theme WIRING (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Employee is selected by typing ?employeeId=<uuid> (calendar/page.tsx:18,58-63); no session-derived "me", and no employee picker or name display (DPDP-safe self view).
- **Verified evidence:** calendar/page.tsx:18 reads employeeId from ?employeeId, :58-63 shows 'Select an employee' EmptyState telling user to append a uuid; no name shown. But overstated as a leak: GET /v1/hrms/nominations (training/routes.ts:82-89) self-scopes bare 'employee' callers via resolveOwnEmployeeIdIfBareEmployee (routes.ts:37-44) so a typed foreign id returns the caller's own rows (or []) - mislabelled but not exposed. HR/manager can query any id. No CSV export exists on this page; <Masked> does not exist in the codebase, so the 'fix' text is generic.
- **Files to change:** `apps/web/src/app/(app)/learning/calendar/page.tsx`, `apps/web/src/app/(app)/learning/_data.ts`
- **Fix steps:**
  1. In _data.ts add getMyEmployee() calling getMyProfile() from app/_data/loaders.ts.
  2. In calendar page: if role is employee (or ?employeeId absent) use getMyEmployee().id and drop the 'append ?employeeId' EmptyState; if null show 'No employee record linked to your account'.
  3. Show employee name (fullName from profile) in the My Nominations card header.
  4. Keep ?employeeId override only for HR/manager, and resolve name for it (needs employee lookup; else omit override).
  5. Drop the DPDP-mask/CSV parts of the fix text: no export or secrets on this page.
- **Acceptance:**
  - Logged-in employee opens /learning/calendar with no query: own nominations and name render.
  - Employee with no linked record sees the no-employee-record message, not a uuid prompt.
  - Employee passing another ?employeeId still sees only own data (server self-scope) and own name.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; server already enforces scope. Confirm HR/manager override behaviour before removing the query param.
- **Depends on:** GAP-LEARNING-HOME-02

### GAP-LEARNING-CALENDAR-02  ·  MEDIUM  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Named "Training Calendar" but renders two tables; dates are raw API strings joined with "→" (page.tsx:27,41), no month/week view, and past sessions (completed) are mixed with upcoming ones.
- **Verified evidence:** Title 'Training Calendar' but page renders two DataTables (calendar/page.tsx:72,94); no month/week view. Dates are raw API strings: programme window joins startDate/endDate with ' → ' (:27), nomination 'when' likewise (:41), unformatted. Programmes are not split into upcoming/past; status column (upcoming/ongoing/completed/cancelled from training/queries.ts mapTrainingStatus) is the only cue. Note formatIndianDate (apps/web/src/lib/formatters.ts:2) exists but outputs dd/mm/yyyy, not 'dd Mon yyyy', and there is no formatIndianDateTime.
- **Files to change:** `apps/web/src/app/(app)/learning/calendar/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Wrap p.startDate/p.endDate and n.sessionDate/startDate/endDate in formatIndianDate() and build 'a → b' from formatted parts.
  2. Sort programmes by startDate and sort/split into 'Upcoming & ongoing' vs 'Completed' groups (or default the status filter).
  3. Decide dd/mm/yyyy vs dd Mon yyyy once and, if the latter, change formatIndianDate centrally.
  4. Month/week grid view: defer as a separate design decision.
- **Acceptance:**
  - Programme with startDate 2026-10-05 shows 05/10/2026 (or agreed format) not ISO.
  - Upcoming programmes appear before completed ones.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; display-only. Timezone: date-only strings parse as UTC in formatIndianDate, check no off-by-one.

### GAP-LEARNING-CALENDAR-03  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE (was WIRING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle explains nomination approval (approver ≠ nominator, waitlisting) but the page has no nominate, approve or withdraw action; POST /nominations (training/routes.ts:91-101) is unused here.
- **Verified evidence:** Subtitle (calendar/page.tsx:52) describes maker-checker nomination approval and waitlisting, but the page has no nominate/approve/withdraw control and calls only getTrainingPrograms and getMyNominations (:20,36); POST /v1/hrms/nominations exists (training/routes.ts:91-100, self-scoped for non-HR) and is unused by web. Approval endpoint not seen in this file.
- **Files to change:** `apps/web/src/app/(app)/learning/calendar/page.tsx`, `apps/web/src/app/(app)/learning/_data.ts`
- **Fix steps:**
  1. Short term: reword subtitle to describe what the page shows (schedule + your nomination status).
  2. Optional: add 'Nominate me' server action posting to /api/v1/hrms/nominations with {trainingId, employeeId} via a client button using ActionButton/useConfirmAction from ds.
  3. Approve/reject belongs on an HR approvals screen; verify the approval route in training-admin/routes.ts before wiring.
- **Acceptance:**
  - Subtitle no longer promises actions that do not exist, or nominate button creates a nomination and row appears with state 'pending'.
  - Duplicate nomination shows a human error, not a raw code.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Nomination writes are self-scoped server-side; do not send another employee's id from UI.

### GAP-LEARNING-CALENDAR-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Nominations failure has no retry: badge + EmptyState only (page.tsx:64-68), unlike the programmes card which uses RefreshErrorState.
- **Verified evidence:** Nominations failure branch (calendar/page.tsx:64-68) renders DataSourceBadge plus a static EmptyState 'Could not load nominations' with no retry, whereas programmes card (:89-90) uses RefreshErrorState. Note: the error EmptyState is at least distinct from the empty state, so it is not masked as empty.
- **Files to change:** `apps/web/src/app/(app)/learning/calendar/page.tsx`
- **Fix steps:**
  1. Replace the EmptyState at :67 with <RefreshErrorState error={toHumanError('load',{area:'nominations'})} /> and drop DataSourceBadge.
  2. Check RefreshErrorState props (backHref optional) as used at :90.
- **Acceptance:**
  - Force nominations 500: card shows retry control matching the programmes card.
  - Programmes card unaffected.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-LEARNING-CALENDAR-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Capacity shown as "28 / 30" text with no full/waitlist cue or progress; "— " when maxCapacity is absent (page.tsx:29).
- **Verified evidence:** seats string is `${enrolledCount ?? 0} / ${maxCapacity ?? '—'}` (calendar/page.tsx:29): plain text, no full/waitlist cue, no bar. Also enrolledCount is nomination count from countNominationsByTraining (training/queries.ts:15), not approved seats, so 'enrolled' label is loose. ds ProgressBar exists.
- **Files to change:** `apps/web/src/app/(app)/learning/calendar/page.tsx`
- **Fix steps:**
  1. Add numeric fields and render via a cellType/render helper: when enrolled>=max show a 'Full - waitlist' StatusPill.
  2. Optionally render ds ProgressBar inside the cell.
  3. Rename column to 'Nominations / Capacity' unless backend counts approved only.
- **Acceptance:**
  - Programme 30/30 shows Full cue; 28/30 shows no cue.
  - maxCapacity null renders 'Open' not '0 / —'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-LEARNING-CALENDAR-06  ·  LOW  ·  partly  ·  theme PAGINATION (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** training-programs is listed for every ALL_ROLES caller with a fixed limit (training/routes.ts:66-70); no date range filter, so the list grows unboundedly.
- **Verified evidence:** training-programs is ALL_ROLES (training/routes.ts:66-68) and takes listQuerySchema limit (:69); web calls it with no limit or date filter (_data.ts:11-16), so default limit applies and results are capped, not unbounded; cache keyed per limit (queries.ts:13). No date-range/upcoming filter exists in the endpoint. Old theme DATEFMT is wrong.
- **Files to change:** `services/hrms-service/src/modules/training/routes.ts`, `services/hrms-service/src/modules/training/queries.ts`, `apps/web/src/app/(app)/learning/_data.ts`
- **Fix steps:**
  1. Add optional from/to (or upcoming=true) query fields to the list schema and repo.listTrainingsByTenant.
  2. Pass them from getTrainingPrograms() defaulting to current FY window.
  3. Add pagination note or pager in calendar UI.
- **Acceptance:**
  - GET training-programs?from=&to= returns only overlapping programmes.
  - Calendar page requests bounded window.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Cache key must include the new params. Programmes list schema is in @civitasone/schemas (not in snapshot); cannot verify default limit value.


---
## /learning/competency  —  `learning/competency.html`

- **Source:** `apps/web/src/app/(app)/learning/competency/page.tsx`
- **Design reference:** `redesign/learning/competency.html`

### GAP-LEARNING-COMPETENCY-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** "Competency" columns print raw UUIDs (competency/page.tsx:29,36) — the level table is unreadable for HR and a manager; names live at GET /competency/competencies (competency/routes.ts:74) but are never joined.
- **Verified evidence:** HeldRow.competencyId and GapRow.competencyId are rendered directly in the 'Competency' columns (competency/page.tsx:29,36 in file numbering; cols at lines 176,196). GET /v1/hrms/competency/competencies (competency/routes.ts:74-78, ALL_ROLES) returns names but web has no loader for it (_data.ts).
- **Files to change:** `apps/web/src/app/(app)/learning/_data.ts`, `apps/web/src/app/(app)/learning/competency/page.tsx`
- **Fix steps:**
  1. Add getCompetencies() loader in _data.ts for /api/v1/hrms/competency/competencies (inspect response shape first; fields not visible in snapshot).
  2. In page, fetch in the same Promise.all and build Map(id -> name/code).
  3. Map competencyId to name (fallback '—' not uuid) in heldRows and gapRows.
  4. Same for other pages that print course/competency ids.
- **Acceptance:**
  - Held and gap tables show competency names.
  - Unknown id shows 'Unknown competency', never a uuid.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Response shape of /competencies unverified.

### GAP-LEARNING-COMPETENCY-02  ·  HIGH  ·  partly  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Employee and role are typed into the URL (?employeeId=<uuid>&roleCode=<ROLE>) (page.tsx:11-12); there is no picker, no name display for whose profile is on screen, and a missing roleCode silently hides the gap analysis card.
- **Verified evidence:** employeeId/roleCode come from query string (competency/page.tsx:11-12) and page shows 'Select an employee' with 'Append ?employeeId=<uuid>&roleCode=<ROLE>' (:18). No picker, no employee name shown. Gap card is guarded by `roleCode &&` (:72) so absent roleCode hides the card silently. Server side: profile/gap-analysis apply assertEmployeeReadable (competency/routes.ts:20-28,115,127), so bare employees only read own record. No EntityPicker exists in the repo.
- **Files to change:** `apps/web/src/app/(app)/learning/competency/page.tsx`, `apps/web/src/app/(app)/learning/_data.ts`
- **Fix steps:**
  1. Default employeeId to getMyProfile().id for employees; show name in header.
  2. For HR/manager add employee search (no EntityPicker component exists - build one or reuse an HR employee list loader).
  3. Add role selector fed by GET /competency/roles... (list endpoint not verified) or a text input, and show hint card 'Choose a role to see gaps' when roleCode empty.
- **Acceptance:**
  - Employee opens page with no query and sees own held competencies and name.
  - Missing roleCode shows explicit prompt for gap analysis.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; server enforces ownership.
- **Depends on:** GAP-LEARNING-CALENDAR-01

### GAP-LEARNING-COMPETENCY-03  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Level is shown as "L3" inside a status pill and "Source" as another status pill (page.tsx:63-64), so neutral facts get status semantics; there is no level definition.
- **Verified evidence:** Level ('L3') and source cellType 'status' (competency/page.tsx:63-64 in file numbering; columns lines 177-178) render through StatusPill (DataTable.tsx:127), giving neutral facts status colouring. No level definitions are fetched.
- **Files to change:** `apps/web/src/app/(app)/learning/competency/page.tsx`
- **Fix steps:**
  1. Remove cellType:'status' from level and source columns.
  2. Keep status pill only for the gap 'met/gap' column.
  3. Optional: tooltip with level definition when API supplies it.
- **Acceptance:**
  - Level and Source render as plain text; met/gap keeps pill.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-LEARNING-COMPETENCY-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Stat cards (Met, Gaps, Readiness) appear only when a role analysis exists; on gap-analysis error they vanish with no indication, while the held card can still render (page.tsx:33,45,75).
- **Verified evidence:** StatGrid renders only when `analysis` non-null (competency/page.tsx:45 in file numbering). On gap.source==='error' data is null so stats vanish while the Gap analysis card shows RefreshErrorState (:76), so an error is indicated in the gap card but stats disappear without their own cue; held card independent. Overstated: there is a visible error in the gap card.
- **Files to change:** `apps/web/src/app/(app)/learning/competency/page.tsx`
- **Fix steps:**
  1. When roleCode set and gap.source==='error', render placeholder stats with '—' or omit with the card's error prominently above.
  2. Show stat grid skeleton state when roleCode present and analysis null.
- **Acceptance:**
  - Gap endpoint 500: stats show '—' and gap card shows retry.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-LEARNING-COMPETENCY-05  ·  LOW  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Gap page says "No requirements or all met" for two different situations (page.tsx:78); Readiness % has no bar or threshold.
- **Verified evidence:** EmptyState title 'No requirements or all met' (competency/page.tsx:78 in file numbering) conflates two cases; analysis.requiredCount distinguishes them. Readiness shows `${readinessPct}%` in a StatCard with no bar/threshold (:75).
- **Files to change:** `apps/web/src/app/(app)/learning/competency/page.tsx`
- **Fix steps:**
  1. If analysis.requiredCount===0 show 'No competency requirements defined for role X'.
  2. Otherwise if all met show 'All requirements met'.
  3. Add ds ProgressBar under Readiness.
- **Acceptance:**
  - requiredCount 0 shows the no-requirements message; all met shows success message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /learning/courses  —  `learning/courses.html`

- **Source:** `apps/web/src/app/(app)/learning/courses/page.tsx`
- **Design reference:** `redesign/learning/courses.html`

### GAP-LEARNING-COURSES-01  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13: closed by #1916; re-confirmed in W1 SF-16, #2004)
- **First-pass claim:** Draft and retired courses are listed to every role: listCourses has no status filter (learning/repo.ts:22-31) while the page says "published courses" (page.tsx:22,33). The Status column exposes it, but non-published rows still link to a detail page.
- **Verified evidence:** repo.listCourses (learning/repo.ts:22-31) filters only tenant and search; GET /learning/courses (routes.ts:34-39) allows ALL_ROLES with no status filter, so draft/retired courses reach employees. Page copy says 'published courses' (courses/page.tsx:22,33 in file numbering ~ lines 115,126), Status column shown, and rows link to detail (rowLinkPrefix). Detail endpoint also serves drafts to all roles (routes.ts:41-53) though enrol requires published (:129).
- **Files to change:** `services/hrms-service/src/modules/learning/routes.ts`, `services/hrms-service/src/modules/learning/repo.ts`, `apps/web/src/app/(app)/learning/courses/page.tsx`
- **Fix steps:**
  1. Backend: add status param to listCourses; for non-HR roles force status='published' in the route; same guard on GET courses/:id (404 for non-published to non-HR).
  2. Web: for HR keep a status filter; otherwise nothing changes.
  3. Add route tests per role.
- **Acceptance:**
  - Employee GET /learning/courses returns only published.
  - HR sees all with status filter.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; verify draft authoring UI uses HR role.

### GAP-LEARNING-COURSES-02  ·  MEDIUM  ·  partly  ·  theme SEARCH (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Two search mechanisms, neither visible together: server ?q= (page.tsx:10) has no input, the DataTable filter is client-side over the first 100 rows (repo.ts:22 limit 100; no pager note).
- **Verified evidence:** Server ?q= is read (courses/page.tsx:10 -> getCourses(q), _data.ts:22-28) but there is no input that sets it; the DataTable filterable search (page.tsx ~142) is client-side over rows fetched with repo limit 100 (repo.ts:22), with no pager note or count-vs-total. Not a dead route as theme claims.
- **Files to change:** `apps/web/src/app/(app)/learning/courses/page.tsx`
- **Fix steps:**
  1. Add a GET <form> (input name=q, defaultValue=q) above the table so search hits the server.
  2. Remove client filterable, or keep it clearly labelled as page filter.
  3. Show 'showing first 100' notice when rows.length===100 or add total/offset support in API.
- **Acceptance:**
  - Typing 'safety' and submitting reloads with ?q=safety and filtered results.
  - With >=100 rows the truncation is disclosed.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-LEARNING-COURSES-03  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Credit hours arrive as a string and print "12.0 hrs" (page.tsx:15); category has no pill or grouping.
- **Verified evidence:** creditHours is a string in Course type (_data.ts:20) and printed `${c.creditHours} hrs` (courses/page.tsx:15) producing '12.0 hrs' (also in learning/page.tsx). Category is plain text. Precision claim depends on DB numeric string; not verified.
- **Files to change:** `apps/web/src/app/(app)/learning/courses/page.tsx`, `apps/web/src/app/(app)/learning/page.tsx`
- **Fix steps:**
  1. Add formatCreditHours() (Number, strip trailing .0, singular 'hr') in lib/formatters.ts and use in both pages and detail page.
  2. Optionally render category with a neutral pill.
- **Acceptance:**
  - '12.0' displays '12 hrs'; '1.5' shows '1.5 hrs'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-LEARNING-COURSES-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** No enrolment state per course (already enrolled / prerequisites unmet) in the catalogue, though enrol is enforced server-side (learning/routes.ts:122-142).
- **Verified evidence:** Catalogue rows (courses/page.tsx:8-16) have no enrolment/prerequisite state; getMyLearning exists (_data.ts:44) but is not used; enrol checks happen server-side only (routes.ts:122-142).
- **Files to change:** `apps/web/src/app/(app)/learning/courses/page.tsx`, `apps/web/src/app/(app)/learning/_data.ts`
- **Fix steps:**
  1. Fetch getMyLearning(myEmployeeId) in parallel and add 'My status' column (Enrolled/In progress/Completed/-).
  2. Prerequisite state needs API support (course list has none); mark as backend follow-up or show only on detail.
- **Acceptance:**
  - Enrolled course shows its status in the catalogue.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Extra call per page load; low.
- **Depends on:** GAP-LEARNING-COURSES-DETAIL-02


---
## /learning/courses/[id]  —  `learning/courses-detail.html`

- **Source:** `apps/web/src/app/(app)/learning/courses/[id]/page.tsx`
- **Design reference:** `redesign/learning/courses-detail.html`

### GAP-LEARNING-COURSES-DETAIL-01  ·  HIGH  ·  defect  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** "Enrol Now" is a native HTML form POST straight to /api/v1/hrms/learning/courses/{id}/enroll with a hidden employeeId (page.tsx:46-49): urlencoded (the route expects JSON), bypassing the /api/proxy auth path; apps/web has no /api/v1 route handler (only proxy, auth, notification, metrics…) and the rewrite config is not in the snapshot (undeterminable). The result is at best a raw JSON page.
- **Service:** `hrms-service`  ·  **Endpoint(s):** `['POST /v1/hrms/learning/courses/{id}/enroll']`
- **Question:** See evidence.
- **How to verify:** Verified by reading source; see evidence.
- **Test to add:** Given employee E, when E POSTs JSON enroll with another employee's id then 403; own id then 201.
- **Impact if wrong:** Enrolment fails and any user can enrol others.
- **Web change if wrong:** See fix_steps.
- **Finding:** Service route POST /v1/hrms/learning/courses/:id/enroll (services/hrms-service/src/modules/learning/routes.ts:122-153) parses req.body with enrollBody = z.object({employeeId: uuid}) (learning/validators.ts:32-34) and is role-gated to ALL_ROLES (routes.ts:15-16). Web page renders <form action=/api/v1/hrms/learning/courses/{id}/enroll method=post> (learning/courses/[id]/page.tsx:46-49) which sends application/x-www-form-urlencoded; no urlencoded content-type parser is registered for the learning routes (only one addContentTypeParser in leave/routes.ts:193), so Fastify returns 415, and apps/web has no /api/v1 route handler (app/api has activation, auth, careers, metrics, notification, proxy only), so the URL depends on unseen rewrites. Also no ownership check: any ALL_ROLES caller may enrol any employeeId (routes.ts:126-133 never compares body.employeeId to the actor), and web takes employeeId from the ?employeeId= query string. Idempotent re-enrol is fine (routes.ts:144).

### GAP-LEARNING-COURSES-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W1 SF-16: closed by #2004)
- **W0-10 note:** review found the W0 tick partly — Self-scoping + 403 NO_EMPLOYEE_LINK in learning/routes.ts:149-150,191-192 and IDOR tests exist, but no audit event for HR enrolling on behalf (no audit/emit anywhere in modules/learning); acceptance point missing
- **First-pass claim:** Enrolment takes employeeId from the body with only a role check (learning/routes.ts:122-127; ALL_ROLES). Combined with an employeeId typed in the URL, any employee can enrol any colleague.
- **Verified evidence:** Enrol route POST /v1/hrms/learning/courses/:id/enroll (learning/routes.ts:122-154) uses ALL_ROLES and takes employeeId from enrollBody (validators.ts:32) with no self-scope, unlike nominations (training/routes.ts:57-63). Creates enrolment for any employeeId in the tenant. Web supports it by hidden input from ?employeeId (courses/[id]/page.tsx:47). Same lack of scoping on GET /learning/my-learning (routes.ts:188-193) and POST lessons/:id/progress (:156).
- **Files to change:** `services/hrms-service/src/modules/learning/routes.ts`, `apps/web/src/app/(app)/learning/courses/[id]/page.tsx`
- **Fix steps:**
  1. Backend: add resolveOwnEmployeeIdIfNonHr-style helper (copy from training/routes.ts:57) to enroll, lessons/progress and my-learning; 403 NO_EMPLOYEE_LINK when unlinked.
  2. Ignore body.employeeId for non-HR callers; emit audit event for HR enrolling on behalf.
  3. Web: derive employeeId from getMyProfile() and remove hidden input source from URL; HR enrol-on-behalf only via picker.
  4. Add route tests: employee enrolling another id is enrolled as self / rejected.
- **Acceptance:**
  - Employee POST enroll with colleague uuid -> enrolment is created for self only (or 403).
  - HR officer can still enrol another employee and an audit event is recorded.
  - Unlinked user gets 403.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Authorization change; enrolment/manager flows that rely on enrolling reports must be preserved for manager role - decide.
- **Depends on:** GAP-LEARNING-COURSES-DETAIL-04

### GAP-LEARNING-COURSES-DETAIL-03  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 re-confirmed W1 SF-02/03 (#2010): closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** The course cannot be consumed: lessons are listed without links and no lesson-player or progress route exists in learning/ (POST /learning/lessons/:id/progress is never called from web), so “Enrol to start learning” has no next step.
- **Verified evidence:** Lesson table (courses/[id]/page.tsx:79-88) has no links; no lesson player route exists (learning/ has assessments, calendar, competency, courses, my-learning, training-plans only) and grep finds no web call to /learning/lessons/:id/progress. The enrol form posts to /api/v1/hrms/learning/courses/:id/enroll (:46); no post-enrol redirect visible. contentUri is in the Lesson type (_data.ts:30) but never displayed. my-learning has resumeLessonId with no destination route.
- **Files to change:** `apps/web/src/app/(app)/learning/courses/[id]/lessons/[lessonId]/page.tsx`, `apps/web/src/app/(app)/learning/courses/[id]/page.tsx`, `apps/web/src/app/(app)/learning/my-learning/page.tsx`, `apps/web/src/app/(app)/learning/_data.ts`
- **Fix steps:**
  1. Add route learning/courses/[id]/lessons/[lessonId]/page.tsx rendering lesson content by contentType/contentUri (check safe embedding/sanitisation).
  2. Add 'Mark complete' server action calling POST /learning/lessons/:id/progress with self employeeId; refresh progress.
  3. Make lesson titles links (DataTable rowLink or a Link cell) enabled only when enrolled.
  4. Link 'Resume' from my-learning using resumeLessonId.
- **Acceptance:**
  - Enrolled user opens a lesson and marks it complete; my-learning progress updates.
  - Unenrolled user sees lesson list without links and an enrol prompt.
- **Needs:** web  ·  **Effort:** L >2d  ·  **Risk:** Content embedding of contentUri (external URLs) is an XSS/CSP concern.
- **Depends on:** GAP-LEARNING-COURSES-DETAIL-02

### GAP-LEARNING-COURSES-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** A failed fetch is shown as "Course not found" (page.tsx:15-21); prerequisites are printed as raw course UUIDs (page.tsx:67) and the fallback button links to ?employeeId= with an empty value (page.tsx:51).
- **Verified evidence:** `!course || source === 'error'` maps fetch error to 'Course not found' EmptyState (courses/[id]/page.tsx:15-21); real 404 and 5xx are indistinguishable. Prerequisites printed as raw ids (`{p}` :67; API returns prerequisite uuids, routes.ts:47-52). Fallback button links to `?employeeId=` (empty) at :51, labelled 'Enrol (add ?employeeId=...)'.
- **Files to change:** `apps/web/src/app/(app)/learning/courses/[id]/page.tsx`, `apps/web/src/app/(app)/learning/_data.ts`
- **Fix steps:**
  1. Split branches: source==='error' -> <RefreshErrorState error={toHumanError('load',{area:'course'})} backHref='/learning'/>; only null with source 'api' -> notFound()/Course not found.
  2. Resolve prerequisite ids to titles via getCourses() lookup (or extend GET course detail to return titles) and link them.
  3. Remove the empty-employeeId button; when employeeId is derived from session (see COURSES-DETAIL-02) always show Enrol Now.
- **Acceptance:**
  - API 500: retry state shown, not 'Course not found'.
  - Prerequisites display course titles linking to their pages.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-LEARNING-COURSES-DETAIL-02

### GAP-LEARNING-COURSES-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Enrol on an unmet prerequisite returns 409 PREREQUISITES_NOT_MET (learning/routes.ts:130-137) but the UI has no pre-check or message.
- **Verified evidence:** Server returns 409 {code:'PREREQUISITES_NOT_MET', missing} (learning/routes.ts:137-139). Web enrol is a native HTML form POST to the API URL (courses/[id]/page.tsx:46) with no client handling, no pre-check and no message, so the user lands on a raw JSON/error response. Whether the /api/v1 proxy accepts urlencoded bodies is cannot-verify (enrollBody expects JSON; only leave/routes adds a content-type parser).
- **Files to change:** `apps/web/src/app/(app)/learning/courses/[id]/page.tsx`, `apps/web/src/app/(app)/learning/courses/[id]/EnrolButton.tsx`
- **Fix steps:**
  1. Replace form with a client EnrolButton using fetch POST JSON + useToast; on 409 PREREQUISITES_NOT_MET list missing courses via titles.
  2. Pre-check: compare course.prerequisites with the caller's completed enrolments (getMyLearning) and disable Enrol with explanation.
  3. On success router.refresh() and link to first lesson.
- **Acceptance:**
  - Enrolling with unmet prereq shows message naming missing courses; no navigation to JSON.
  - Met prereqs: enrol succeeds and status shows enrolled.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-LEARNING-COURSES-DETAIL-02, GAP-LEARNING-COURSES-DETAIL-04

### GAP-LEARNING-COURSES-DETAIL-06  ·  LOW  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** moduleId is read via an unsafe cast because the Lesson type omits it (page.tsx:31; _data.ts:30); lesson contentUri is never shown.
- **Verified evidence:** Lesson type (_data.ts:30) lacks moduleId; page casts `(l as unknown as {moduleId?:string})` (courses/[id]/page.tsx:31). Backend lessons rows include moduleId (listLessonsByCourse returns table rows). contentUri is typed but never rendered.
- **Files to change:** `apps/web/src/app/(app)/learning/_data.ts`, `apps/web/src/app/(app)/learning/courses/[id]/page.tsx`
- **Fix steps:**
  1. Add moduleId: string to Lesson type.
  2. Remove the unsafe cast.
  3. Show contentUri as a link only inside the lesson player (see COURSES-DETAIL-03).
- **Acceptance:**
  - tsc passes without cast; module column still resolves names.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-LEARNING-COURSES-DETAIL-03


---
## /learning/my-learning  —  `learning/my-learning.html`

- **Source:** `apps/web/src/app/(app)/learning/my-learning/page.tsx`
- **Design reference:** `redesign/learning/my-learning.html`

### GAP-LEARNING-MY-LEARNING-01  ·  HIGH  ·  confirmed  ·  theme IDOR (was PII)

- [x] **Status** (W1 SF-16: closed by #2004)
- **W0-10 note:** review found the W0 tick partly — IDOR closed (shared/self-scope.ts, learning/routes.ts:220-231 my-learning and :237-252 dashboard fail closed; real-DB idor test). Missing: fix step 5/acceptance 2 - no audit event when HR/manager read another employee's enrolments (no audit call in learning/routes.ts my-learning/dashboard handlers; test has no audit assertion). Manager can read any employee id (same as training, documented)
- **First-pass claim:** IDOR: GET /learning/my-learning?employeeId= only requires an ALL_ROLES role (learning/routes.ts:188-193), so any employee can read any colleague’s course enrolments and progress by changing the UUID (DPDP). Contrast training/routes.ts:22-60 which forces bare employees onto their own record.
- **Verified evidence:** services/hrms-service/src/modules/learning/routes.ts:188-193: GET /v1/hrms/learning/my-learning does requireRole(ctx, ALL_ROLES) then repo.listMyEnrollments(ctx.tenantId, employeeId) with the client-supplied uuid (repo.ts:162-174, filtered only by tenant+employeeId); no comparison to the caller. training/routes.ts:22-38 (resolveOwnEmployeeIdIfBareEmployee via resolveEmployeeForActor) does force bare employees onto their own record, learning does not. Same gap on GET /learning/dashboard (employeeId optional, tenant-wide counts for every role) and web page.tsx:9,20 passes the URL param straight through.
- **Files to change:** `services/hrms-service/src/modules/learning/routes.ts`, `services/hrms-service/src/shared/self-scope.ts (new, extract helper)`, `services/hrms-service/src/modules/training/routes.ts`, `services/hrms-service/src/modules/learning/__tests__/my-learning.idor.test.ts (new)`
- **Fix steps:**
  1. Extract resolveOwnEmployeeIdIfBareEmployee from training/routes.ts:22-38 into a shared helper (uses employee/actor-link.ts resolveEmployeeForActor) and import it in both modules.
  2. In the my-learning handler make employeeId optional (zod .optional()); compute effective = helper(ctx, req, employeeId ?? ''); if null return [] (fail closed).
  3. For a bare employee always use the resolved own hrms_employees id, ignoring the query value; HR_ROLES and manager pass the requested id through (same judgment as training).
  4. Apply the same scoping to /learning/dashboard: bare employee => own id; only HR/manager may omit employeeId for tenant-wide counts.
  5. Emit an audit event when HR/manager reads another employee's enrolments (CLAUDE.md audit rule).
  6. Add tests: employee A requesting employee B's uuid gets A's rows; HR gets B's.
- **Acceptance:**
  - Unit/route test: ctx.roles=['employee'], query employeeId=<other uuid> -> response contains only the caller's enrolments.
  - Route test: HR role with other employeeId -> that employee's enrolments and an audit event recorded.
  - Bare employee with no linked hrms_employees record -> [] (not 403 leak, not another user's data).
- **Needs:** backend  ·  **Effort:** S ~half day  ·  **Risk:** Access-control change on DPDP-relevant personal data; manager pass-through is still unscoped to direct reports (same as training). Breaking risk: any caller relying on employee role reading colleagues.
- **Depends on:** GAP-LEARNING-MY-LEARNING-02

### GAP-LEARNING-MY-LEARNING-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0-10 note:** review found the W0 tick partly — Self-view works (getMyProfile fallback, 'No employee record linked' state, server-side optional employeeId routes.ts:227) but no HR employee picker and the viewed employee's name is not shown (learning/my-learning/page.tsx:60-100 has static subtitle); acceptance 'HR with ?employeeId sees that employee, with name shown' unmet
- **First-pass claim:** "My Learning" is not "mine": the employee is chosen by typing ?employeeId=<uuid> into the URL (page.tsx:9-17); a signed-in employee has no way to know their own hrms_employees id and the landing tiles link here without it.
- **Verified evidence:** apps/web/src/app/(app)/learning/my-learning/page.tsx:9-17 reads searchParams.employeeId only; without it the page shows EmptyState 'Append ?employeeId=<uuid>'. Home tiles (apps/web/src/app/(app)/learning/page.tsx:47-56) and Sidebar.tsx:77 link to /learning/my-learning with no id. A loader for the caller's own record exists: getMyProfile() in apps/web/src/app/_data/loaders.ts:~1150 (GET /api/v1/hrms/me/profile) returns id (assumed hrms_employees id; confirm against me/profile handler).
- **Files to change:** `apps/web/src/app/(app)/learning/my-learning/page.tsx`, `apps/web/src/app/(app)/learning/_data.ts`, `services/hrms-service/src/modules/learning/routes.ts`
- **Fix steps:**
  1. In page.tsx, when employeeId is absent call getMyProfile() and use profile.id; render the current 'Select an employee' state only if profile is null (404 => non-employee account, show a friendly 'no employee record linked' EmptyState).
  2. Show only for HR_ROLES (getSessionRoles from @/lib/auth/roleGuard) an employee search/picker (name/employeeNo) instead of a raw uuid; keep ?employeeId= as an HR-only deep link.
  3. Preferred: make employeeId optional server-side (see -01) so the web needs no id at all for self view.
  4. Show the employee name in PageHeader subtitle when viewing someone else.
- **Acceptance:**
  - Sign in as an employee, open /learning/my-learning with no query -> own enrolments listed, no uuid typed.
  - Non-employee admin account (me/profile 404) -> 'no employee record linked' message, not an error banner.
  - HR with ?employeeId=<uuid> still sees that employee, with name shown.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; must not ship before -01 or self-view just makes the IDOR easier to find. Confirm me/profile id space equals enrolment employeeId.
- **Depends on:** GAP-LEARNING-MY-LEARNING-01

### GAP-LEARNING-MY-LEARNING-03  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle promises a "resume point" but resumeLessonId is never used and no Resume action exists (page.tsx:14,28).
- **Verified evidence:** resumeLessonId is declared on MyEnrollment (apps/web/src/app/(app)/learning/_data.ts:42) and returned by the API (learning/repo.ts:167) but page.tsx builds Row without it (lines 21-24) and renders no action; subtitle at page.tsx:14 and :28 promises a 'resume point'. No per-lesson route exists (learning/courses/[id]/page.tsx lists lessons in a DataTable with no link).
- **Files to change:** `apps/web/src/app/(app)/learning/my-learning/page.tsx`, `apps/web/src/app/(app)/learning/courses/[id]/page.tsx`, `apps/web/src/app/(app)/learning/_data.ts`
- **Fix steps:**
  1. Add resumeLessonId and courseId to Row; add an 'Action' column with a Continue link to /learning/courses/{courseId}?lesson={resumeLessonId} (no lesson route exists today) for status enrolled/in_progress.
  2. In courses/[id]/page.tsx highlight/scroll to the lesson matching ?lesson= (or add a real /learning/courses/[id]/lessons/[lessonId] player if content viewer is in scope).
  3. If resume is not delivered now, drop 'and resume point' from both subtitles.
- **Acceptance:**
  - Enrolment with resumeLessonId shows a Continue link that opens the course at that lesson.
  - Completed enrolment or null resumeLessonId shows no Continue link.
  - Subtitle text matches what the page offers.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. A player route is a separate, larger feature (decision).

### GAP-LEARNING-MY-LEARNING-04  ·  LOW  ·  confirmed  ·  theme UX (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1916; re-confirmed in W1 SF-16, #2004)
- **First-pass claim:** Progress is plain text "65%" without a bar or overdue cue although overdue counts are on the home page (page.tsx:23).
- **Verified evidence:** apps/web/src/app/(app)/learning/my-learning/page.tsx:23 sets progress: `${e.progressPct}%` as text; DataTable column is a plain right-aligned string. ds/ProgressBar.tsx exists (value 0-100). 'Overdue' on the home page is a heuristic in learning/repo.ts:197-211 (enrolled/in_progress and not updated for 30 days), not a due date; MyEnrollment carries no due/updatedAt field, so a per-row overdue cue needs a field.
- **Files to change:** `apps/web/src/app/(app)/learning/my-learning/page.tsx`, `apps/web/src/app/(app)/learning/_data.ts`, `services/hrms-service/src/modules/learning/routes.ts`
- **Fix steps:**
  1. Give the progress column a render that shows <ProgressBar value={progressPct}> plus the number (keep text for a11y/sorting; store numeric progressPct in Row).
  2. Optionally expose updatedAt (already selected in repo.listMyEnrollments) in MyEnrollment and show an 'Overdue' StatusPill when the same 30-day rule applies; share the rule via one constant so page and dashboard agree.
  3. Decision: define overdue via a real due date (training-plan item targetDate) instead of staleness.
- **Acceptance:**
  - Row at 65% shows a bar at 65% and the text '65%'.
  - Sorting by Progress orders numerically (65 before 100 not '100%' < '65%').
  - Stale enrolment shows the overdue cue consistent with home-page count.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; overdue semantics is a business decision.

### GAP-LEARNING-MY-LEARNING-05  ·  LOW  ·  partly  ·  theme COPY (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Raw enrolment status (enrolled / in progress / completed) is the only state; there is no certificate link on completed courses.
- **Verified evidence:** True: status column shows the raw enum with underscores replaced (apps/web/src/app/(app)/learning/my-learning/page.tsx:23, cellType 'status') and there is no certificate link. Not fixable in web alone: assessment routes expose only GET /v1/hrms/assessment/certificates/verify/:token (assessment/routes.ts:277) and attempt-scoped certificate lookup (:272); enrolments are not linked to assessments/certificates and there is no list-by-employee endpoint.
- **Files to change:** `apps/web/src/app/(app)/learning/my-learning/page.tsx`, `services/hrms-service/src/modules/learning/routes.ts`, `services/hrms-service/src/modules/assessment/routes.ts`
- **Fix steps:**
  1. Decision: how a completed course maps to a certificate (assessment.courseRef exists on Assessment type in _data.ts:71).
  2. Backend: add certificateNo/verifyToken to the my-learning response for completed enrolments (or a GET certificates?employeeId= endpoint with the -01 self-scoping).
  3. Web: add a 'Certificate' column linking to the existing verify page/route for completed rows; humanize status via humanizeStatus() from lib/formatters.ts.
- **Acceptance:**
  - Completed enrolment with a certificate shows a working link; in-progress shows none.
  - Status shows 'In progress' not 'in progress' style raw text.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Certificates are verifiable credentials; must be scoped to owner (IDOR risk if added carelessly).
- **Depends on:** GAP-LEARNING-MY-LEARNING-01


---
## /learning/training-plans  —  `learning/training-plans.html`

- **Source:** `apps/web/src/app/(app)/learning/training-plans/page.tsx`
- **Design reference:** `redesign/learning/training-plans.html`

### GAP-LEARNING-TRAINING-PLANS-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Plans are a dead end: rows have no link and there is no /learning/training-plans/[id] page although getTrainingPlanDetail and the API return items (course, target date, mandatory) (_data.ts:130-142; learning/routes.ts:277-285).
- **Verified evidence:** apps/web/src/app/(app)/learning/training-plans/page.tsx:92-104 DataTable has no rowHref/rowLinkKey; directory has only page.tsx and loading.tsx (no [id]). getTrainingPlanDetail exists but is unused (apps/web/src/app/(app)/learning/_data.ts:130-142); API GET /v1/hrms/learning/training-plans/:id (learning/routes.ts ~277-285) returns plan + items {id, courseId, trainingId, targetDate, mandatory} (courseId/trainingId are ids, so course titles need getCourses/getTrainingPrograms lookup).
- **Files to change:** `apps/web/src/app/(app)/learning/training-plans/page.tsx`, `apps/web/src/app/(app)/learning/training-plans/[id]/page.tsx (new)`, `apps/web/src/app/(app)/learning/training-plans/[id]/loading.tsx (new)`
- **Fix steps:**
  1. Add rowHref={(r)=>`/learning/training-plans/${r.id}`} to the DataTable.
  2. Create [id]/page.tsx: call getTrainingPlanDetail(id); if source==='error' render RefreshErrorState (status 404 -> notFound()).
  3. Resolve item course/training titles via getCourses() and getTrainingPrograms() maps; table columns Course/Programme, Target date (formatIndianDate), Mandatory (Yes/No).
  4. Show plan header (title, year, scope, status); back link to list.
- **Acceptance:**
  - Click a plan row -> detail opens with its items and titles.
  - Unknown id -> not-found; API failure -> RefreshErrorState, not 'not found'.
  - Mandatory flag 1/0 renders Yes/No.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only page.

### GAP-LEARNING-TRAINING-PLANS-02  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W1 SF-06 re-confirmed on this branch (training-plans/page.tsx has the HR-gated New plan action and CreatePlanForm now uses a department picker): closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Empty state tells HR admins they can create plans, but there is no create action or route and the page does no role check (page.tsx:35-39; POST /training-plans is HR_ROLES, learning/routes.ts:263-266).
- **Verified evidence:** Empty-state message at apps/web/src/app/(app)/learning/training-plans/page.tsx:86-90 says HR admins can create plans; page has no create button/route and no role check. Backend POST /v1/hrms/learning/training-plans requires HR_ROLES (learning/routes.ts:263-266) and accepts title, planYear, departmentId?, roleCode?. Session roles helper exists: getSessionRoles in @/lib/auth/roleGuard (used in hr/disciplinary/page.tsx:5,42).
- **Files to change:** `apps/web/src/app/(app)/learning/training-plans/page.tsx`, `apps/web/src/app/(app)/learning/training-plans/new/page.tsx (new)`, `apps/web/src/app/(app)/learning/training-plans/new/CreatePlanForm.tsx (new)`
- **Fix steps:**
  1. In page.tsx call getSessionRoles(); for HR roles add a '+ New plan' link to /learning/training-plans/new; for others change the empty message to 'No plans published yet'.
  2. Create the new-plan form (zod-validated, posts to /api/proxy/v1/hrms/learning/training-plans, fields title, planYear, department or role) using useFormError like legal forms.
  3. Keep the server HR_ROLES check as the authority (already present).
- **Acceptance:**
  - Employee sees no create link and no admin wording.
  - HR sees '+ New plan'; submit returns 202 and plan appears (note POST is async via publishF3Write).
  - Non-HR POST -> 403 from API.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; POST is 202-accepted, list may lag until consumer runs.
- **Depends on:** GAP-LEARNING-TRAINING-PLANS-01

### GAP-LEARNING-TRAINING-PLANS-03  ·  MEDIUM  ·  confirmed  ·  theme ENTITYNAME (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Scope loses information: a department plan prints only the word "Department" (page.tsx:14) — departmentId is neither resolved to a name nor shown.
- **Verified evidence:** apps/web/src/app/(app)/learning/training-plans/page.tsx:65 (obs said 14): scope = p.roleCode ?? (p.departmentId ? 'Department' : 'All'); departmentId is never resolved or shown; a plan with both roleCode and departmentId shows only the role.
- **Files to change:** `apps/web/src/app/(app)/learning/training-plans/page.tsx`, `apps/web/src/app/(app)/learning/_data.ts`
- **Fix steps:**
  1. Resolve departmentId to a name using the existing HRMS department loader (locate in apps/web/src/app/_data or hr module; add getDepartments() if absent).
  2. Render scope as 'Dept: <name>' and/or 'Role: <code>' (show both when both set); fall back to 'All staff'.
  3. Never show the raw uuid.
- **Acceptance:**
  - Department plan shows the department name.
  - Plan with role+dept shows both.
  - Unresolvable dept id shows 'Department (unknown)' not a uuid.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-LEARNING-TRAINING-PLANS-04  ·  LOW  ·  partly  ·  theme COPY (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Plan year prints as a bare number ("2026") for a fiscal-year (April–March) plan; there is no dates/owner/enrolment progress column.
- **Verified evidence:** planYear is printed via String(p.planYear) (apps/web/src/app/(app)/learning/training-plans/page.tsx:64). The TrainingPlan type has no dates/owner (_data.ts:119-122), and API validates planYear as int 2020-2100 only; nothing states it is an April-March fiscal year, so the 'FY' label is an assumption. Enrolment progress per plan is not in the list payload. Not a date-format issue.
- **Files to change:** `apps/web/src/app/(app)/learning/training-plans/page.tsx`, `apps/web/src/lib/fiscalYear.ts`
- **Fix steps:**
  1. Decision: confirm planYear semantics with product; if fiscal, render 'FY 2026-27' using lib/fiscalYear.ts helpers.
  2. Owner/dates/progress columns require backend fields (not in listTrainingPlans) - defer or raise a backend ticket.
  3. Keep column sortable numerically.
- **Acceptance:**
  - Plan 2026 shows 'FY 2026-27' (if decided) and sorts correctly.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Mislabelling a calendar-year plan as FY would be wrong; verify first.

### GAP-LEARNING-TRAINING-PLANS-05  ·  LOW  ·  partly  ·  theme CAP

- [x] **Status** (W0 2026-10-13: closed by #1916; re-confirmed in W1 SF-16, #2004)
- **First-pass claim:** listTrainingPlans has no pagination or year filter surfaced in the UI; ALL_ROLES can read every plan.
- **Verified evidence:** repo.listTrainingPlans(tenantId, limit=100) orders by planYear and hard-caps at 100 (learning/repo.ts:258-265); route (learning/routes.ts:257-261) exposes no limit/offset/year params and returns a bare array with no total. The web DataTable filters/pages client-side (pageSize 15, filterable) over that capped array. ALL_ROLES read is by design (plans are not personal data) - not a defect.
- **Files to change:** `services/hrms-service/src/modules/learning/routes.ts`, `services/hrms-service/src/modules/learning/repo.ts`, `apps/web/src/app/(app)/learning/_data.ts`, `apps/web/src/app/(app)/learning/training-plans/page.tsx`
- **Fix steps:**
  1. Add zod query (year?, limit, offset) to the list route and return {data,total}; repo does count + offset.
  2. Update getTrainingPlans(year, page) and mapResponse; page reads searchParams year/page.
  3. Add a year Segmented/select filter in the page; show 'Showing x of total'.
- **Acceptance:**
  - Tenant with 150 plans: total shows 150 and page 2 fetchable.
  - ?year=2026 returns only that year.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; response shape change needs coordinated loader update.
