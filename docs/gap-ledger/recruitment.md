# Detailed gap file — module `recruitment`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 84, BACKEND-VERIFY 1



---
## /careers  —  `recruitment/careers-home.html`

- **Source:** `apps/web/src/app/careers/page.tsx`
- **Design reference:** `redesign/recruitment/careers-home.html`

### GAP-RECRUITMENT-CAREERS-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** Contractual and Deputation vacancies get a card and a badge but no filter chip, so they can only be found under ‘All openings’ (page.tsx:34-40 vs 25-32).
- **Verified evidence:** careers/page.tsx:25-32 TYPE_LABELS has contractual and deputation, but TYPE_FILTER_OPTIONS (34-40) lists only All, Regular, Internship, Apprenticeship, Volunteer. Cards for those types render (134) with badges; typing ?type=contractual would filter but no chip links to it.
- **Files to change:** `apps/web/src/app/careers/page.tsx`
- **Fix steps:**
  1. Add { value:'contractual', label:'Contractual' } and { value:'deputation', label:'Deputation' } to TYPE_FILTER_OPTIONS
  2. Derive the option list from TYPE_LABELS keys so they cannot drift
  3. Optionally hide chips with zero vacancies except the active one
- **Acceptance:**
  - A vacancy of type deputation is reachable via a Deputation chip
  - Chip counts match card counts
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-RECRUITMENT-CAREERS-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme BRANDING (was OTHER)

- [x] **Status** — PR #1822 (merged)
- **First-pass claim:** No department, state or Government identity anywhere on the page: hero shows a ◈ glyph and ‘Powered by CivitasOne’; a Govt of Odisha tenant looks like a generic vendor board (page.tsx:73-82,176). The login page says ‘Government of India’ instead (LoginForm.tsx:70).
- **Verified evidence:** Hero (73-82) has a '◈' glyph, 'Join Our Team' and generic text; footer 176-178 'Powered by CivitasOne · Equal opportunity employer'. No department/organisation name or emblem. Login form says 'Government of India' hard-coded (LoginForm.tsx:70), so the two are inconsistent. Tenant name is not fetched. Whether the tenant is Govt of Odisha cannot be verified from code.
- **Files to change:** `apps/web/src/app/careers/page.tsx`, `apps/web/src/app/careers/portal/login/LoginForm.tsx`, `apps/web/src/app/careers/[id]/page.tsx`
- **Fix steps:**
  1. Expose tenant public profile (organisation name, department, emblem URL) via the vacancies endpoint or a public tenant-branding endpoint (confirm existing one first)
  2. Create shared CareersHeader component showing organisation name and emblem, used by careers home, vacancy detail, portal pages
  3. Replace hard-coded 'Government of India' in LoginForm.tsx:70 with tenant name
  4. Reword footer to 'Powered by CivitasOne' in small text only
- **Acceptance:**
  - Header shows configured organisation name on all careers pages
  - Login page shows same name
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Branding accuracy on a public government page.

### GAP-RECRUITMENT-CAREERS-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** Emoji (📍💰👥🎓⚠️📋) are the only icons, are not marked aria-hidden on the meta spans, and are read out by screen readers before every value (page.tsx:162-165).
- **Verified evidence:** Spans at careers/page.tsx:162-165 contain `📍 {v.location}` etc. inline in the text node with no aria-hidden wrapper, so screen readers announce emoji names ('round pushpin'). Decorative emoji at 74,118,127 are aria-hidden. Vacancy detail uses InfoCard which does aria-hide its icon (page.tsx:323 in file). Also 'Apply by' label lacks emphasis. Theme I18N is wrong: a11y.
- **Files to change:** `apps/web/src/app/careers/page.tsx`
- **Fix steps:**
  1. Wrap each emoji in <span aria-hidden="true"> at lines 162-165 and add a visually hidden label ('Location:', 'Pay:', 'Positions:', 'Qualification:')
  2. Or replace emoji with lucide-react icons (aria-hidden) for consistent rendering
- **Acceptance:**
  - Screen reader reads 'Location: Bhubaneswar' with no emoji name
  - axe scan reports no issue on card
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-RECRUITMENT-CAREERS-HOME-04  ·  LOW  ·  confirmed  ·  theme EMPTY_STATE (was OTHER)

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** Filtered-empty and truly-empty share one message; a filter with no matches gives no way back except the ‘All openings’ chip (page.tsx:125-131).
- **Verified evidence:** careers/page.tsx:125-131 shows 'No openings right now / Check back soon' whenever the filtered list is empty. With an active type filter and other types available this is misleading; only the chip row lets the user leave.
- **Files to change:** `apps/web/src/app/careers/page.tsx`
- **Fix steps:**
  1. When activeType is set and allVacancies.length>0 but vacancies.length===0 render 'No <type> openings' with a Link to /careers ('View all openings')
  2. Keep current copy for genuinely empty list
- **Acceptance:**
  - /careers?type=internship with none shows filter-specific message and a link back
  - Empty tenant still shows 'No openings right now'
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-RECRUITMENT-CAREERS-HOME-05  ·  LOW  ·  partly  ·  theme CAP

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** No search, sort or pagination; the whole published list is rendered (page.tsx:133-172, queries.ts:54-69).
- **Verified evidence:** No search/sort/pagination in the UI (page.tsx:132-172 maps all vacancies) is true; filtering is client-side on the fetched list (66-68). The cited queries.ts:54-69 does not exist under careers; the fetch is page.tsx:46-61 and the backend is queries.listPublishedVacancies (routes.ts:210). Whether it caps or paginates is not checked here and volume may be small for one tenant.
- **Files to change:** `apps/web/src/app/careers/page.tsx`, `services/hrms-service/src/modules/recruitment/queries.ts`, `services/hrms-service/src/modules/recruitment/routes.ts`
- **Fix steps:**
  1. Check queries.listPublishedVacancies for limit; add ?limit/offset (or cursor), q and type params on GET /v1/careers/vacancies returning total
  2. Pass searchParams q,page to the fetch in page.tsx and render search input and pager links
  3. Sort by closesAt ascending by default; show closing-soon first
- **Acceptance:**
  - With 60 published vacancies page 1 shows 20 and pager reaches page 3
  - Searching 'clerk' returns only matching titles
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-RECRUITMENT-CAREERS-HOME-06  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** No loading.tsx or Suspense on a page that blocks on a network call with a 5 s timeout (page.tsx:53).
- **Verified evidence:** No loading.tsx anywhere under apps/web/src/app/careers (only app/error.tsx and not-found.tsx at root), and page.tsx:50-54 awaits fetch with 5000 ms timeout, so a slow backend blanks navigation for up to 5 s (force-dynamic).
- **Files to change:** `apps/web/src/app/careers/loading.tsx (new)`, `apps/web/src/app/careers/page.tsx`
- **Fix steps:**
  1. Add careers/loading.tsx with a skeleton of the header, chip row and 3 card placeholders (role=status, aria-busy)
  2. Optionally add careers/error.tsx with retry for unexpected throws
- **Acceptance:**
  - Throttle backend: skeleton appears immediately, replaced by list
  - Skeleton has no layout shift versus loaded page
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-RECRUITMENT-CAREERS-HOME-07  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** — PR #1822 (merged)
- **First-pass claim:** All copy is hard-coded English; no next-intl keys (page.tsx:9-10,76-82). Odia/Hindi are not offered on a public Government page.
- **Verified evidence:** All copy in careers/page.tsx (metadata 5-7, hero 76-82, filters 34-40, empty/error 119-129, footer 177) is hard-coded English; no useTranslations. src/i18n/config.ts exists for the app group but no locale handling on the public careers route. Odia/Hindi absence is a requirement inference, not verified in a spec.
- **Files to change:** `apps/web/src/app/careers/page.tsx`, `apps/web/src/i18n/config.ts`, `apps/web/src/app/careers/[id]/page.tsx`, `apps/web/src/app/careers/[id]/ApplyForm.tsx`
- **Fix steps:**
  1. Confirm supported public locales (en/hi/or) with product
  2. Add careers.* keys to message catalogs and wrap careers layout in the next-intl provider
  3. Replace literals with t() calls; add LanguageSwitcher (exists in _components) to the careers header
  4. Server components use getTranslations
- **Acceptance:**
  - ?locale switch shows Hindi hero text
  - No hard-coded English strings remain (lint rule or grep)
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Translation quality for government text needs review.
- **Depends on:** GAP-RECRUITMENT-CAREERS-DETAIL-09

### GAP-RECRUITMENT-CAREERS-HOME-08  ·  LOW  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** Inline #94a3b8 footer text on white is below 4.5:1 contrast (page.tsx:176).
- **Verified evidence:** Footer style at careers/page.tsx:176 colour #94a3b8 on the white/near-white page gradient (about 2.6:1) fails 4.5:1. Same colour is used for other small text in careers pages.
- **Files to change:** `apps/web/src/app/careers/page.tsx`
- **Fix steps:**
  1. Change footer colour to a token >=4.5:1 such as #64748b/#475569
  2. Share the token with the other careers pages (see DETAIL-07)
- **Acceptance:**
  - Contrast of footer text >=4.5:1 in axe/Lighthouse
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-RECRUITMENT-CAREERS-DETAIL-07


---
## /careers/[id]  —  `recruitment/careers-detail.html`

- **Source:** `apps/web/src/app/careers/[id]/page.tsx`
- **Design reference:** `redesign/recruitment/careers-detail.html`

### GAP-RECRUITMENT-CAREERS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED (was UUID)

- [x] **Status** — PR #1788 (merged)
- **First-pass claim:** The success reference is fabricated client-side as APP-<current year>-<last 6 hex chars of the UUID> (ApplyForm.tsx:90,103), while the portal shows the real applicationNo (portal/page.tsx:129). The candidate is told a number that may not match what they later see.
- **Verified evidence:** ApplyForm.tsx:79-80 stores data.id from the response and 90-91,103 builds APP-{new Date().getFullYear()}-{id.slice(-6).toUpperCase()} on the client. The backend returns applicationNo in the 202 body (hrms routes.ts:268 { id, applicationNo, status }) and 409 DUPLICATE details, and the portal shows applicationNo (portal/page.tsx:129, detail page:72). The fabricated string is therefore not the real number, and the year is the browser's, not the stored one. Login ?ref link (line 91) carries the same fake value and LoginForm shows it as 'tracking application'.
- **Files to change:** `apps/web/src/app/careers/[id]/ApplyForm.tsx`, `apps/web/src/app/careers/portal/login/LoginForm.tsx`
- **Fix steps:**
  1. In ApplyForm.tsx:79 type the response as { id?: string; applicationNo?: string | null } and keep applicationNo in state
  2. Render applicationNo at line 103 and in loginHref (line 91); if null, show 'Reference will be emailed' rather than a derived string
  3. Delete trackRef/new Date().getFullYear() derivation
  4. On 409 DUPLICATE_APPLICATION read details.applicationNo (via formError) and show 'You already applied: <no>'
- **Acceptance:**
  - Component test: mock POST returning {id:'...abc123',applicationNo:'REC/2026/0042'} shows REC/2026/0042, never APP-<year>-ABC123
  - Manual: reference on success screen equals the number on /careers/portal
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Confirm applicationNo is populated at insert (commands.submitPublicApplication) else the null path must be handled.

### GAP-RECRUITMENT-CAREERS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** No DPDP notice or consent on a form collecting name, email, mobile, qualification: only ‘sent securely and used only for this recruitment process’ (ApplyForm.tsx:186-188). No purpose, retention, grievance officer or consent checkbox.
- **Verified evidence:** ApplyForm.tsx:186-188 is the only privacy text ('sent securely and used only for this recruitment process'), in #94a3b8 12px. Form collects name, email, mobile, qualification (116-128). No consent checkbox, purpose, retention, grievance officer or privacy-notice link; publicApplicationBody (validators.ts:46-64) has no consent field so nothing is recorded server-side. CLAUDE.md/docs/SECURITY.md name DPDP as a requirement. Theme PII is right but the fix text (Masked) is not: this is consent/notice.
- **Files to change:** `apps/web/src/app/careers/[id]/ApplyForm.tsx`, `apps/web/src/app/careers/[id]/page.tsx`, `services/hrms-service/src/modules/recruitment/validators.ts`, `services/hrms-service/src/modules/recruitment/commands.ts`, `services/hrms-service/src/modules/recruitment/schema.ts`
- **Fix steps:**
  1. Decide notice text (purpose, retention period, grievance officer contact, link to privacy policy) with the legal owner
  2. Add a required unchecked consent checkbox above Submit in ApplyForm.tsx; block submit and show inline error if unticked
  3. Add consentGivenAt/consentVersion to publicApplicationBody (z.literal(true) + version string) and persist in submitPublicApplication with an audit event
  4. Send consent flag in body at ApplyForm.tsx:41-49
- **Acceptance:**
  - Submit without ticking box: no network call, inline error announced via role=alert
  - POST without consent returns 400 VALIDATION_FAILED; with consent the application row stores consent timestamp/version
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Legal/compliance risk if left; schema migration touches hrms_applications.

### GAP-RECRUITMENT-CAREERS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was DATEFMT)

- [x] **Status** — PR #1822 (merged)
- **First-pass claim:** No reservation category (SC/ST/OBC/EWS/PwBD) or date of birth is collected, yet the HR side computes reservation fill from application.category (recruitment [id]/page.tsx:603-617) and public-sector posts need age/category eligibility.
- **Verified evidence:** Form fields (ApplyForm.tsx:117-128) and publicApplicationBody (validators.ts:46-64) contain no category or date of birth. HR page apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx:603-617 (path in the observation is incomplete) computes reservation fill from a.category over applications and shows an unavailable state when none have category. schema.ts:63 has a category varchar(16) column so it can only be set by HR; candidates cannot self-declare. Whether age/category eligibility is required is a policy decision. Theme DATEFMT is wrong.
- **Files to change:** `apps/web/src/app/careers/[id]/ApplyForm.tsx`, `services/hrms-service/src/modules/recruitment/validators.ts`, `services/hrms-service/src/modules/recruitment/commands.ts`, `services/hrms-service/src/modules/recruitment/schema.ts`
- **Fix steps:**
  1. Get decision on required fields (category enum SC/ST/OBC/EWS/PwBD/UR, DOB) and certificate evidence
  2. Add optional category select and date-of-birth input to ApplyForm.tsx with labels; send in body
  3. Extend publicApplicationBody with category enum and dateOfBirth (ISO date, past) and persist in submitPublicApplication; DOB is PII so encrypt like other PII
  4. Show category as unverified until HR verifies a document
- **Acceptance:**
  - Selecting SC and submitting stores category='sc' (case must match HR page lowercase compare at 614)
  - Future DOB rejected with field error
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Self-declared reservation category affects merit lists; DOB is sensitive PII.
- **Depends on:** GAP-RECRUITMENT-CAREERS-DETAIL-04

### GAP-RECRUITMENT-CAREERS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1822 (merged)
- **First-pass claim:** No resume/document upload; qualification is free text (ApplyForm.tsx:121).
- **Verified evidence:** No file input in ApplyForm.tsx; qualification is a plain text Field (123-124, line 121 in observation is off by 2) mapped to qualification string max 500. Hrms has resume-routes/resume-domain.ts, but the public apply payload has no document reference and no public upload endpoint is used by the form.
- **Files to change:** `apps/web/src/app/careers/[id]/ApplyForm.tsx`, `services/hrms-service/src/modules/recruitment/resume-routes.ts`
- **Fix steps:**
  1. Check resume-routes.ts / storage adapter for a public, size- and type-limited upload endpoint; add one if missing (S3/MinIO adapter, virus scan)
  2. Add optional resume file input (PDF/DOC, max size) to ApplyForm.tsx and upload before or with submit, sending returned documentId
  3. Convert qualification to a select of standard levels plus free-text 'course/institution'
- **Acceptance:**
  - Upload of a 6 MB .exe is rejected with clear message; PDF <=5 MB is accepted and linked to the application
  - Application detail on HR side shows the resume
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Public unauthenticated upload is an abuse and malware vector; needs rate limit and scanning.
- **Depends on:** GAP-RECRUITMENT-CAREERS-DETAIL-02

### GAP-RECRUITMENT-CAREERS-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme FORM_VALIDATION (was FAILMASK)

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** Form uses noValidate and only checks name/email are non-empty; malformed email or mobile is sent to the server and comes back as a generic error (ApplyForm.tsx:38-43,116).
- **Verified evidence:** noValidate at ApplyForm.tsx:116 and client check only for empty name/email (33-37) are true. But the backend does validate (email z.string().email, mobile min 10, name min 2: validators.ts:48-50), returns fieldErrors (routes.ts errorHandler) and the form routes errors through useFormError.fromResponse (line 74), so the message is not necessarily generic; it shows only a single banner, not per-field errors. Also the name minimum (2) is not checked client-side and experience/mobile formats are unchecked. Theme FAILMASK is wrong.
- **Files to change:** `apps/web/src/app/careers/[id]/ApplyForm.tsx`, `apps/web/src/lib/useFormError.ts`
- **Fix steps:**
  1. Add client validators mirroring publicApplicationBody (email regex, mobile 10-20 digits, name >=2, experience integer >=0)
  2. Track fieldErrors state; render message under each input with aria-describedby and aria-invalid; focus first invalid
  3. Map server fieldErrors (field, message) to inputs when present, keep banner for non-field errors
  4. Remove noValidate or keep it and call the validators
- **Acceptance:**
  - Enter 'abc' email: inline error under Email, no request sent
  - Server 400 with fieldErrors[{field:'mobile'}] shows under Mobile
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; keep client rules no stricter than backend.

### GAP-RECRUITMENT-CAREERS-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** Any fetch failure or non-2xx for the vacancy becomes notFound(), so a temporary outage shows ‘404 — Page not found’ (page.tsx:29-33,45), the same conflation UX-013 fixed on the list page.
- **Verified evidence:** careers/[id]/page.tsx getVacancy (lines 20-34) returns null on !res.ok and on any exception (timeout 5s); line 45 `if (!v) notFound()`, so a gateway outage renders app/not-found.tsx '404 — Page not found'. Home page already separates errored (careers/page.tsx:46-61,116-124). Also generateMetadata (36-39) calls getVacancy a second time, doubling requests.
- **Files to change:** `apps/web/src/app/careers/[id]/page.tsx`
- **Fix steps:**
  1. Change getVacancy to return { vacancy, status: 'ok'|'notfound'|'error' }: 404 -> notfound; other non-2xx and exceptions -> error
  2. In VacancyPage call notFound() only for 'notfound'; for 'error' render the same 'Couldn't load' card as careers/page.tsx:116-124 with a retry link
  3. Wrap getVacancy in React cache() so generateMetadata and the page share one fetch
- **Acceptance:**
  - Mock fetch 500: page shows 'Couldn't load this vacancy' with Try again, HTTP status not 404
  - Mock 404: not-found page still shown
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-RECRUITMENT-CAREERS-DETAIL-07  ·  MEDIUM  ·  partly  ·  theme A11Y (was FABRICATED)

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** Inline hint colours #94a3b8 on white and field placeholders as sole format hints fall below contrast; submit button is #4f46e5 while other careers pages use #154089 (ApplyForm.tsx:174-180).
- **Verified evidence:** Verified: #94a3b8 text on white (ApplyForm.tsx:101,108,186 privacy line; page.tsx InfoCard label 325-> line 113) is about 2.6:1, below 4.5:1; submit button is #4f46e5 at line 178 (observation's 174-180 ok) while home page and success screen use #154089 (careers/page.tsx:95,121; ApplyForm.tsx:102,105). Placeholders are also the only format hints (e.g. 'e.g. 9876543210'), though labels exist for every field. Also the back link is #4f46e5 (page.tsx:52). Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/careers/[id]/ApplyForm.tsx`, `apps/web/src/app/careers/[id]/page.tsx`, `apps/web/src/app/careers/page.tsx`
- **Fix steps:**
  1. Create shared careers tokens (e.g. careers/theme.ts or CSS vars) for primary #154089 and muted text #64748b (4.6:1) and use them in ApplyForm, page.tsx, careers/page.tsx
  2. Replace #94a3b8 text with the muted token at ApplyForm.tsx:101,108,186 and page.tsx InfoCard label
  3. Change submit background (line 178) and back-link colour to the primary token; keep disabled state accessible
  4. Add visible hint text (id, aria-describedby) for mobile and stipend formats instead of relying on placeholder
- **Acceptance:**
  - Contrast checker: all body/hint text >=4.5:1 on its background
  - Submit button and 'Track my application' share the same colour
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; visual only.
- **Depends on:** GAP-RECRUITMENT-CAREERS-HOME-08

### GAP-RECRUITMENT-CAREERS-DETAIL-08  ·  LOW  ·  partly  ·  theme WIRING (was OTHER)

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** ‘Positions’ card always renders even if vacancies is 0 (page.tsx:84); closed check trusts the web server clock, not the backend isApplicationOpen (page.tsx:47 vs routes.ts:233-236).
- **Verified evidence:** Positions card: page.tsx:76 (`<InfoCard label="Positions" value={String(v.vacancies)}>`, observation's line 84 is wrong) renders unconditionally, so 0 or missing shows '0'. Closed check line 47 `v.closesAt && new Date(v.closesAt) < new Date()` uses the Next server clock and only the deadline; backend isApplicationOpen (job-publication.ts:35-40) also requires status==='open' and isPublished, and lives in routes.ts:240 (observation's 233-236 is off). Impact is limited: the public GET /vacancies/:id serves published vacancies only (routes.ts:215-223) and POST /apply enforces the rule with 409 VACANCY_CLOSED, so a cancelled/closed vacancy would show the form but be refused on submit.
- **Files to change:** `apps/web/src/app/careers/[id]/page.tsx`, `services/hrms-service/src/modules/recruitment/routes.ts`
- **Fix steps:**
  1. Render Positions InfoCard only when v.vacancies > 0 (page.tsx:76)
  2. Ask backend to add `applicationOpen: boolean` (and closedReason) to the public vacancy payload computed by isApplicationOpen/applicationClosedReason
  3. Use v.applicationOpen in page.tsx:47 instead of the local clock; fall back to date check if field missing
- **Acceptance:**
  - vacancies=0 renders no Positions card
  - Payload applicationOpen=false shows the closed banner with the reason even when closesAt is in the future
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; server still enforces on submit.

### GAP-RECRUITMENT-CAREERS-DETAIL-09  ·  LOW  ·  confirmed  ·  theme COPY (was FABRICATED)

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** Placeholder examples name Delhi institutions (IIT Delhi, SRCC, ITI/2023/DL) on an Odisha tenant (ApplyForm.tsx:135,151); all strings are hard-coded English.
- **Verified evidence:** ApplyForm.tsx placeholders: 'e.g. B.Com (Hons), Delhi University' (123), 'e.g. IIT Delhi, SRCC, Delhi University' (134), 'e.g. ITI/2023/DL/12345' (153). All labels, errors and success text are hard-coded English (no next-intl; src/i18n exists only for the authenticated app). Whether the tenant is Odisha is not visible in code (DEMO_TENANT_ID env), so 'Odisha tenant' is an assumption.
- **Files to change:** `apps/web/src/app/careers/[id]/ApplyForm.tsx`
- **Fix steps:**
  1. Replace Delhi examples with neutral or tenant-agnostic ones ('e.g. B.Sc., State University', 'e.g. ITI/2023/XX/12345')
  2. Move all strings in ApplyForm.tsx and careers pages to next-intl messages (en, hi, or) once a public-route provider exists
  3. Optionally read example institution from tenant config
- **Acceptance:**
  - grep 'Delhi' in careers/ returns none
  - Locale switch to hi shows translated labels (after i18n work)
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-RECRUITMENT-CAREERS-HOME-07

### GAP-RECRUITMENT-CAREERS-DETAIL-10  ·  LOW  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** Stipend field multiplies by 100 without rounding, so 15000.5 gives fractional paise (ApplyForm.tsx:55).
- **Verified evidence:** ApplyForm.tsx:55 `Number(stipendExpected) * 100`: input type=number allows decimals, so 15000.555 yields 1500055.5 which backend z.number().int() (validators.ts:58) rejects with a 400, and 15000.5 (1500050) is fine; float can also give values like 1.005*100=100.49999. Observation's example 15000.5 actually gives an integer 1500050; the real failure is 3+ decimal places or float error, which produces a validation error rather than stored fractional paise. Negative values also pass client-side (backend nonnegative rejects).
- **Files to change:** `apps/web/src/app/careers/[id]/ApplyForm.tsx`
- **Fix steps:**
  1. Set min=0 step=1 (or 0.01) on the stipend Field
  2. Convert via a shared rupees->paise helper using string parsing (split on '.') or Math.round(parseFloat(v)*100) after validating <=2 decimals
  3. Validate finite and >=0 before sending; show inline error
- **Acceptance:**
  - '15000.5' sends 1500050; '15000.555' shows 'Enter up to 2 decimals' and does not submit
  - '-5' is rejected client-side
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; money field but expected-stipend only, not a payment.


---
## /careers/portal  —  `recruitment/careers-portal.html`

- **Source:** `apps/web/src/app/careers/portal/page.tsx`
- **Design reference:** `redesign/recruitment/careers-portal.html`

### GAP-RECRUITMENT-CAREERS-PORTAL-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** — PR #1788 (merged)
- **First-pass claim:** ‘Sign out’ links to GET /api/careers/auth/logout, but only otp-request, otp-verify and apply exist under apps/web/src/app/api/careers; the link 404s and the cand_token cookie is never cleared (portal/page.tsx:78).
- **Verified evidence:** apps/web/src/app/careers/portal/page.tsx:78 <Link href='/api/careers/auth/logout'>. apps/web/src/app/api/careers contains only apply/, auth/otp-request/, auth/otp-verify/ (no logout route). cand_token is httpOnly (otp-verify/route.ts:22-25) so it cannot be cleared client-side; clicking Sign out 404s and the cookie remains valid up to 7 days.
- **Files to change:** `apps/web/src/app/api/careers/auth/logout/route.ts`, `apps/web/src/app/careers/portal/page.tsx`, `apps/web/src/app/careers/portal/application/[id]/page.tsx`
- **Fix steps:**
  1. Create api/careers/auth/logout/route.ts exporting POST that sets cand_token with maxAge 0 (same path '/', httpOnly, sameSite lax) and returns 204/redirect.
  2. Replace the <Link> in page.tsx:78 with a small client <form method='POST' action='/api/careers/auth/logout'> button (a GET must not mutate per CLAUDE.md).
  3. Redirect to /careers/portal/login after logout.
  4. Add the same control to the application detail page header if it has one.
- **Acceptance:**
  - Route test: POST returns Set-Cookie cand_token with Max-Age=0.
  - Manual: sign out, then /careers/portal redirects to login.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Server-side token stays valid until expiry (stateless); acceptable, note for security review.

### GAP-RECRUITMENT-CAREERS-PORTAL-02  ·  HIGH  ·  confirmed  ·  theme STAGE-MAP (was I18N)

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** The backend only ever assigns stage applied | shortlisted | offered | hired | rejected (repo.ts comment), yet the page’s rail and labels are built around screening and interview, and know nothing of rejected or withdrawn. A rejected application shows the raw word ‘rejected’ in grey with a rail that has no active dot (page.tsx:21-38,144-146; services/hrms-service/src/modules/recruitment/repo.ts:400-412).
- **Verified evidence:** apps/web/src/app/careers/portal/page.tsx:19-26 STAGE_LABEL and :28-35 STAGE_COLOR only cover applied, screening, shortlisted, interview, offered, hired; MiniRail (144-172) uses the same six. A 'rejected' stage falls back to applied colour (line 108) and prints the raw word (121); idx is -1 so no dot is active (all grey). Backend writers set only applied/shortlisted/offered/hired/rejected per repo.ts:400-412 comment; the HR hire route also accepts 'selected' (routes.ts:187) and 'withdrawn' exists in AVAILABLE_STAGES, so labels are missing for those too. Screening/interview are never assigned, so rail steps are permanently empty.
- **Files to change:** `apps/web/src/app/careers/portal/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/app/careers/portal/application/[id]/page.tsx`
- **Fix steps:**
  1. Define one shared stage map (applied, shortlisted, selected, offered, hired, rejected, withdrawn, not_selected) with label key, tone and icon.
  2. Render rejected/withdrawn/not_selected as a terminal badge and replace the rail with a one-line status message.
  3. Reduce the rail to stages the backend actually assigns (or confirm with backend when screening/interview will be written).
  4. Fall back to a generic 'In progress' label for unknown stages instead of the raw string.
  5. Use next-intl keys for labels.
- **Acceptance:**
  - Test: stage=rejected renders localised 'Not selected' badge, no rail.
  - Test: unknown stage 'foo' does not render raw 'foo'.
  - Detail page uses the same map.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Candidate-facing wording for rejection needs HR/legal sign-off.

### GAP-RECRUITMENT-CAREERS-PORTAL-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK (was OTHER)

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** Expired or invalid cookie returns 401 which is treated as errored=true (‘couldn’t reach the careers service. Try again’); retrying never works and the candidate is not sent back to login (page.tsx:54).
- **Verified evidence:** apps/web/src/app/careers/portal/page.tsx:54 any non-ok response (including 401 UNAUTHORIZED 'cand_token is invalid or expired' from candidate-public-portal-routes.ts:22-25) returns errored:true; the page then shows 'Couldn't reach the careers service' with a 'Try again' link to the same URL (241-244), which will loop forever for an expired token. The cookie is also never cleared.
- **Files to change:** `apps/web/src/app/careers/portal/page.tsx`
- **Fix steps:**
  1. Return a status from fetchApplications; on 401 call redirect('/careers/portal/login?expired=1').
  2. Show 'Your session expired, please sign in again' on the login page when expired=1.
  3. Keep errored state only for 5xx/network errors.
- **Acceptance:**
  - Test: mocked 401 causes redirect to login.
  - Test: mocked 500 shows retry state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cookie clear on redirect needs a route handler because cookies cannot be mutated during server component render.

### GAP-RECRUITMENT-CAREERS-PORTAL-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** A malformed cookie (not two dot-separated parts) returns errored:false with no applications, so it renders ‘No applications yet’ for a candidate who may have several (page.tsx:43).
- **Verified evidence:** apps/web/src/app/careers/portal/page.tsx:43 `if (parts.length !== 2) return { applications: [], errored: false }` renders 'No applications yet' with a 'Browse Vacancies' CTA for a corrupt cookie. Same pattern for JSON.parse failures? No: parse errors are inside try and give errored:true (line 58), so only the two-part check is wrong.
- **Files to change:** `apps/web/src/app/careers/portal/page.tsx`
- **Fix steps:**
  1. Treat malformed token as unauthenticated: redirect to login (share fix with -03).
  2. Do not return the empty state for any path where the fetch did not succeed.
- **Acceptance:**
  - Test: cookie 'garbage' redirects to login, not empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-RECRUITMENT-CAREERS-PORTAL-03

### GAP-RECRUITMENT-CAREERS-PORTAL-05  ·  MEDIUM  ·  partly  ·  theme A11Y (was I18N)

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** Cards are anchors wrapping div blocks with a chip-only status; stage is conveyed by colour dots plus 10px text; active dot #e07b00 on white is low contrast (page.tsx:139-160).
- **Verified evidence:** apps/web/src/app/careers/portal/page.tsx:110 each card is a <Link> wrapping <div>s (valid HTML5). Status is NOT chip-only-by-colour: the chip carries text from STAGE_LABEL (121). The rail, though, encodes progress by dot colour only (152-155) with 10px labels (165) and the active #e07b00 on white (about 3:1) fails 4.5:1 for text. No aria on the rail.
- **Files to change:** `apps/web/src/app/careers/portal/page.tsx`
- **Fix steps:**
  1. Render the rail as an <ol> with aria-label and aria-current='step' on the active item; add visually-hidden 'completed/current/upcoming' text.
  2. Raise label size to >=12px and use a darker active colour (e.g. #b45309).
  3. Give each link an aria-label like '{job title}, status {label}'.
- **Acceptance:**
  - axe reports no contrast/aria issues on /careers/portal.
  - Screen reader announces current step.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** None.

### GAP-RECRUITMENT-CAREERS-PORTAL-06  ·  LOW  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** jobLocation falls back to the literal ‘India’ and unknown jobs show ‘Unknown Position’ (page.tsx:112; candidate-public-portal-routes.ts:73).
- **Verified evidence:** apps/web/src/app/careers/portal/page.tsx:117 `app.jobLocation ?? 'India'`; backend sends null location (candidate-public-portal-routes.ts:74) and 'Unknown Position' when the job row is missing (:73). Note also the job query at :59-62 loads every job opening of the tenant instead of filtering by jobIds.
- **Files to change:** `apps/web/src/app/careers/portal/page.tsx`, `services/hrms-service/src/modules/recruitment/candidate-public-portal-routes.ts`
- **Fix steps:**
  1. Omit the location fragment when null instead of printing 'India'.
  2. Replace 'Unknown Position' with a translated 'Position no longer listed' or return jobTitle:null and let UI decide.
  3. Backend: add inArray(hrmsJobOpenings.id, jobIds) to the titles query.
- **Acceptance:**
  - Test: null location renders no location text.
  - Backend test: titles query only fetches referenced jobs.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-RECRUITMENT-CAREERS-PORTAL-07  ·  LOW  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** Dates are never shown on the list (appliedAt is fetched but unused), and the list is capped at 50 with no pagination (page.tsx:17; candidate-public-portal-routes.ts:52).
- **Verified evidence:** apps/web/src/app/careers/portal/page.tsx:17 appliedAt is in AppSummary but not rendered in the card (110-135); backend caps at 50 with orderBy appliedAt desc (candidate-public-portal-routes.ts:51-52) with no cursor or total.
- **Files to change:** `apps/web/src/app/careers/portal/page.tsx`, `services/hrms-service/src/modules/recruitment/candidate-public-portal-routes.ts`
- **Fix steps:**
  1. Show 'Applied on <date>' using a locale date formatter in the card footer.
  2. Backend: accept limit/offset (zod) and return total.
  3. Add 'Load more' or pager to the page using a ?page= search param.
- **Acceptance:**
  - Card shows applied date.
  - With 60 seeded applications, page 2 shows the remaining 10.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; 50 applications per candidate is unusual.

### GAP-RECRUITMENT-CAREERS-PORTAL-08  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1793 (merged)
- **First-pass claim:** No loading.tsx, and unlike /careers the fetch has no AbortSignal timeout (page.tsx:48-53).
- **Verified evidence:** apps/web/src/app/careers/portal/page.tsx:47-53 fetch has no signal/timeout (apps/web/src/app/careers/page.tsx:53 uses AbortSignal.timeout(5000)); no loading.tsx under apps/web/src/app/careers. A slow gateway blocks the server render indefinitely.
- **Files to change:** `apps/web/src/app/careers/portal/page.tsx`, `apps/web/src/app/careers/portal/loading.tsx`
- **Fix steps:**
  1. Add signal: AbortSignal.timeout(5000) to the fetch; the catch already maps to errored.
  2. Add careers/portal/loading.tsx with card skeletons.
- **Acceptance:**
  - Test: stalled upstream yields the error state within ~5s.
  - Skeleton shows on slow load.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-06


---
## /careers/portal/application/[id]  —  `recruitment/careers-portal-application-detail.html`

- **Source:** `apps/web/src/app/careers/portal/application/[id]/page.tsx`
- **Design reference:** `redesign/recruitment/careers-portal-application-detail.html`

### GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme PII (was OTHER)

- [x] **Status** — PR #1788 (merged)
- **First-pass claim:** screeningRemarks is HR’s internal screening note and is rendered verbatim to the candidate on the active step (page.tsx:110-114). Nothing in the type or API separates candidate-facing text from internal remarks; a note such as ‘weak communication’ or ‘category certificate doubtful’ would be shown.
- **Verified evidence:** Backend candidate-public-portal-routes.ts:124 returns screeningRemarks straight from hrms_applications; that column is written from HR's screening decision body.remarks (screening-routes.ts:166) and override reason (screening-override-routes.ts:157). Portal page renders it verbatim in the active step (page.tsx:110-114). Any HR remark is disclosed to the candidate; no candidate-facing field exists.
- **Files to change:** `services/hrms-service/src/modules/recruitment/candidate-public-portal-routes.ts`, `apps/web/src/app/careers/portal/application/[id]/page.tsx`, `services/hrms-service/src/modules/recruitment/schema.ts`, `services/hrms-service/src/modules/recruitment/screening-routes.ts`
- **Fix steps:**
  1. Remove screeningRemarks from the portal response in candidate-public-portal-routes.ts:124 immediately (and from AppDetail type)
  2. Add optional candidateMessage (or use rejection-notice content, see rejection-notice.ts) that HR authors explicitly, and return only that
  3. Drop the remarks block in page.tsx:110-114; show standard status text per stage
  4. Add a test in hrms that the portal payload has no screeningRemarks
- **Acceptance:**
  - Set internal remark 'weak communication'; GET /portal/applications/:id response has no such text
  - Portal page shows only standard or HR-approved candidate message
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Data disclosure of internal HR notes; fix soon. Candidates may currently rely on the message.

### GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme WIRING (was DATEFMT)

- [x] **Status** — PR #1788 (merged)
- **First-pass claim:** rejected / withdrawn stages are not in the six-step list, so currentIdx = -1 and every step renders ‘future’ with no active step and no outcome message; a rejected candidate is shown a fully grey journey (portal-routes.ts:162-168; page.tsx:100-124).
- **Verified evidence:** candidate-public-portal-routes.ts buildStageTimeline (approx. 152-170) uses STAGES = applied..hired and currentIdx = STAGES.indexOf(a.stage); for rejected/withdrawn/not_selected (repo.ts:412 AVAILABLE_STAGES) currentIdx=-1 so every entry is 'future' (i<-1 false, i===-1 false). Screening sets stage 'rejected' (screening-routes.ts:165 via stageForScreeningDecision). Page (92-122) renders grey rail and no outcome message. Theme DATEFMT is wrong.
- **Files to change:** `services/hrms-service/src/modules/recruitment/candidate-public-portal-routes.ts`, `apps/web/src/app/careers/portal/application/[id]/page.tsx`
- **Fix steps:**
  1. In buildStageTimeline handle terminal stages: for rejected/not_selected mark steps up to the last reached as done and add a final 'Not selected' entry status 'rejected'; for withdrawn add 'Withdrawn by you'
  2. Extend Stage.status union to include 'ended' and style it distinctly with text label
  3. Return top-level outcome {kind, message} using the approved rejection notice text
  4. Render outcome banner in page.tsx above the rail
- **Acceptance:**
  - Application in stage 'rejected' shows a Not selected step and banner, no active step
  - Withdrawn shows the withdrawn state; unit test for buildStageTimeline
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Candidate communication; wording needs HR/legal approval.
- **Depends on:** GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-01

### GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** All failures (401 expired cookie, 500, network) become notFound(), so an outage or an expired session shows ‘404 — Page not found’ and never redirects back to login (page.tsx:28-33,48).
- **Verified evidence:** fetchApplication (page.tsx:21-35) returns null for 404, any non-ok (incl. 401/403/500) and on catch; line 48 `if (!app_) notFound()`. Missing cookie redirects (45-46) but an expired/invalid token does not. Token format problems (parts.length!==2) also give 404.
- **Files to change:** `apps/web/src/app/careers/portal/application/[id]/page.tsx`
- **Fix steps:**
  1. Return a discriminated result: ok | notfound (404) | unauthorized (401/403 or bad token) | error
  2. On unauthorized: clear cand_token via a route handler and redirect('/careers/portal/login?expired=1')
  3. On error: render a retry card (Link to same URL) instead of notFound()
  4. notFound() only for 404
- **Acceptance:**
  - Mock 401: redirected to login
  - Mock 500: retry card shown, not 404
  - Mock 404: not-found page
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Cookie clearing must happen in a route handler, not during render.

### GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was DATEFMT)

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** ‘Closed’ is labelled next to closesAt even while the vacancy is still open (page.tsx:134); it should read ‘Applications close’ / ‘Closed’ by date.
- **Verified evidence:** page.tsx:134 (printed 315) InfoItem label is hard-coded 'Closed' for job.closesAt regardless of whether the date has passed. Theme DATEFMT is right only loosely; this is copy.
- **Files to change:** `apps/web/src/app/careers/portal/application/[id]/page.tsx`
- **Fix steps:**
  1. Compute const isPast = new Date(job.closesAt) < new Date()
  2. Label = isPast ? 'Closed on' : 'Applications close'
- **Acceptance:**
  - Future closesAt shows 'Applications close'; past date shows 'Closed on'
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme RENDER (was FABRICATED)

- [x] **Status** — PR #1822 (merged)
- **First-pass claim:** `job.vacancies && <InfoItem …/>` renders a literal ‘0’ when vacancies is 0 (page.tsx:132).
- **Verified evidence:** page.tsx:132 `{job.vacancies && <InfoItem .../>}`; with vacancies===0 React renders the text '0' directly in the grid as a stray node (label 'Posts' missing). Line 128 also uses && on strings, which is fine. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/careers/portal/application/[id]/page.tsx`
- **Fix steps:**
  1. Change to `{job.vacancies > 0 && ...}` (or typeof number check)
  2. Lint rule no-leaked-render if available
- **Acceptance:**
  - Render with vacancies 0: no '0' text node in the Vacancy Details grid
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** Journey dates: only ‘Application Submitted’ has a date; screening, shortlist and interview dates are never shown, and an interview step says ‘Interview Scheduled’ with no date or venue (portal-routes.ts:167; page.tsx:107-109).
- **Verified evidence:** buildStageTimeline note is '' for all stages except applied (`s === 'applied' && a.appliedAt`); page shows note only when truthy (107-109). Interview label is fixed 'Interview Scheduled' for stage interview. The portal route does not read interview schedule data (hrms has interview-calendar.ts, interview-comms-repo.ts) and has only screenedAt in the DB row but does not select it. Whether interview date/venue is available per application should be checked in interview-calendar-routes.ts.
- **Files to change:** `services/hrms-service/src/modules/recruitment/candidate-public-portal-routes.ts`, `apps/web/src/app/careers/portal/application/[id]/page.tsx`, `services/hrms-service/src/modules/recruitment/interview-calendar.ts`
- **Fix steps:**
  1. Add stage timestamps to the query (screenedAt, shortlist, offer) where columns exist and set note for those stages
  2. Join interview slot (date/time/mode/venue) for the candidate via the interview module's read API (not cross-module SQL) and add to the interview entry
  3. Change interview label to 'Interview' unless a schedule exists; format dates with IST helper
  4. Render venue/date under the step in page.tsx
- **Acceptance:**
  - Application with scheduled interview shows date, time and venue
  - Stage without timestamp shows no date, no 'Invalid Date'
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Wrong interview details shown to candidates would be costly; publish only confirmed slots.
- **Depends on:** GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-02

### GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-07  ·  LOW  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** Timeline is built from absolutely-positioned divs with no list semantics; state is conveyed by colour and a ‘✓’ that is not labelled, so screen readers do not hear done / current / upcoming (page.tsx:88-124).
- **Verified evidence:** Rail (page.tsx:89-122) is plain divs, no ol/li; done state is a colour dot with an 8px '✓' span not aria-hidden and unlabelled (102); active/future differ by colour only; label colour #94a3b8 for future (104) is low contrast. No aria-current on the active step.
- **Files to change:** `apps/web/src/app/careers/portal/application/[id]/page.tsx`
- **Fix steps:**
  1. Use <ol> with <li> for each step
  2. Add visually hidden text '(completed)', '(current step)', '(upcoming)' and aria-current='step' on the active li
  3. Mark the ✓ aria-hidden; add text/icon difference for state beyond colour
  4. Raise future label contrast
- **Acceptance:**
  - Screen reader reads 'Under Review, current step'
  - axe: no colour-only state issue
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** None.

### GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-08  ·  LOW  ·  confirmed  ·  theme COPY (was FABRICATED)

- [x] **Status** — PR #1822 (merged)
- **First-pass claim:** Hard-coded English; fallback ‘India’ for location (page.tsx:68,68).
- **Verified evidence:** page.tsx:61 (printed 242) shows `job?.location ?? "India"` as the fallback, inventing a location; all labels ('Application Journey', 'Vacancy Details', 'Browse more vacancies', 'In progress...') are hard-coded English. Observation cites line 68 twice; correct line is 61.
- **Files to change:** `apps/web/src/app/careers/portal/application/[id]/page.tsx`
- **Fix steps:**
  1. Drop the 'India' fallback: omit location when null
  2. Move strings to next-intl (see careers HOME-07)
- **Acceptance:**
  - Job with null location shows only refNo
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-RECRUITMENT-CAREERS-HOME-07


---
## /careers/portal/login  —  `recruitment/careers-portal-login.html`

- **Source:** `apps/web/src/app/careers/portal/login/page.tsx`
- **Design reference:** `redesign/recruitment/careers-portal-login.html`

### GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-01  ·  HIGH  ·  confirmed  ·  theme AUTH-UX (was PII)

- [x] **Status** — PR #1788 (merged)
- **First-pass claim:** No resend-code action and no cooldown or attempt counter: a candidate whose email is slow or mistyped must go back and request again, and nothing warns about expiry (LoginForm.tsx:104-133).
- **Verified evidence:** apps/web/src/app/careers/portal/login/LoginForm.tsx:104-133 OTP phase has only a verify button and 'Use a different email' (128-131); no resend button, timer or expiry text. Server OTP TTL is 600s and MAX_ATTEMPTS is 5 (otp-verify.ts:15-16) but neither is surfaced; otp-request response carries expiresIn (candidate-public-auth-routes.ts:221) which the client ignores (LoginForm.tsx:34). Server has no visible resend cooldown in the otp-request handler.
- **Files to change:** `apps/web/src/app/careers/portal/login/LoginForm.tsx`, `services/hrms-service/src/modules/recruitment/candidate-public-auth-routes.ts`
- **Fix steps:**
  1. In requestOtp read expiresIn from the response and store an expiry timestamp in state.
  2. Show a countdown ('Code expires in mm:ss') in the otp phase; disable verify and show 'Code expired' at zero.
  3. Add a 'Resend code' button that re-calls requestOtp, disabled for 30s after each send with a visible countdown.
  4. Parse the 429 MAX_ATTEMPTS response and show 'Too many attempts, request a new code' with the resend button enabled.
  5. Backend (optional): enforce a per-email otp-request cooldown and return 429 with Retry-After.
- **Acceptance:**
  - Component test: after send, resend button disabled until 30s fake-timer elapses, then enabled.
  - Test: at expiry the verify button is disabled and expiry message visible.
  - Manual: 5 wrong codes shows lockout message and enables resend.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Cooldown must be enforced server-side too or it is cosmetic; do not change OTP length/TTL semantics.

### GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-02  ·  MEDIUM  ·  confirmed  ·  theme BRANDING (was OTHER)

- [x] **Status** — PR #1822 (merged)
- **First-pass claim:** The band says ‘Government of India’ for every tenant, while /careers says only ‘CivitasOne’ and the tenant is a State department; identity is inconsistent across the public flow (LoginForm.tsx:70; careers/page.tsx:176).
- **Verified evidence:** apps/web/src/app/careers/portal/login/LoginForm.tsx:70 hard-codes 'Government of India'; apps/web/src/app/careers/page.tsx:177 footer says 'Powered by CivitasOne'. Neither reads tenant branding, so identity differs between /careers and the login page and the GoI claim is wrong for a State tenant.
- **Files to change:** `apps/web/src/app/careers/portal/login/LoginForm.tsx`, `apps/web/src/app/careers/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add a tenant-branding source for public pages (tenant display name) fetched server-side, e.g. in login/page.tsx, and pass it to LoginForm as a prop.
  2. Replace the literal with the tenant name, falling back to a neutral 'Candidate Portal' if not available.
  3. Use the same tenant name component in careers/page.tsx header/footer.
  4. Move strings to next-intl keys.
- **Acceptance:**
  - Login and /careers show the same tenant name for a State tenant.
  - No 'Government of India' literal remains in careers routes (grep).
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Needs a decision on the tenant-branding endpoint; I did not verify one exists for public pages.

### GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** The OTP is echoed back in the input in non-production (devCode) — ensure devCode is stripped in production; the isDev gate lives server-side (candidate-public-auth-routes.ts:222).
- **Verified evidence:** apps/web/src/app/careers/portal/login/LoginForm.tsx:34-35 sets the input to data.devCode when present. The web proxy passes the upstream body through untouched (api/careers/auth/otp-request/route.ts). The gate is server-side: candidate-public-auth-routes.ts:216 isDev = NODE_ENV !== 'production', devCode at :222, so any non-production deploy (staging, UAT) echoes the OTP and anyone who can request a code for an email can log in as that candidate. The same handler has a NOTE (approx. line 225) that email delivery is not implemented yet ('publish a notification event here'), so in production no candidate would receive a code.
- **Files to change:** `services/hrms-service/src/modules/recruitment/candidate-public-auth-routes.ts`, `apps/web/src/app/careers/portal/login/LoginForm.tsx`, `apps/web/src/app/api/careers/auth/otp-request/route.ts`
- **Fix steps:**
  1. Gate devCode on an explicit env flag (e.g. ALLOW_DEV_OTP_ECHO=true) instead of NODE_ENV !== 'production'.
  2. In the web proxy route strip devCode from the body unless the same flag is set.
  3. Wire a notification event (queue) that emails the OTP so production actually delivers codes.
  4. Add a test asserting devCode is absent when the flag is unset.
- **Acceptance:**
  - Integration test: with NODE_ENV=staging and flag unset, response has no devCode.
  - Production build: otp-request response never contains devCode.
  - OTP email is enqueued on request.
- **Needs:** backend  ·  **Effort:** S ~half day  ·  **Risk:** Removing echo breaks local/E2E flows that rely on it; keep behind explicit flag.

### GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-04  ·  MEDIUM  ·  partly  ·  theme A11Y (was I18N)

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** Error text is the raw API message or fixed English strings; no field-level association (no aria-describedby, alert is not linked to the input) and no lockout/rate-limit message (LoginForm.tsx:90,121).
- **Verified evidence:** apps/web/src/app/careers/portal/login/LoginForm.tsx:94 and :123 render error as a plain <p> with no role=alert, no aria-describedby/aria-invalid on the inputs (inputs at 87-92 and 115-121). Text is the raw API message or fixed English ('Could not send OTP', 'Invalid code') at 32, 57. Lockout is NOT missing: server returns 429 MAX_ATTEMPTS with a message (candidate-public-auth-routes.ts:332) which the form displays verbatim; but it is not localised or distinguished.
- **Files to change:** `apps/web/src/app/careers/portal/login/LoginForm.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Give each error <p> an id and role='alert'; set aria-describedby and aria-invalid on the related input.
  2. Map API codes (MAX_ATTEMPTS, OTP_INVALID, expired) to next-intl keys via useTranslations rather than showing d.message.
  3. Add a specific rate-limit/lockout message and focus the input on error.
- **Acceptance:**
  - Test: on failed verify, input has aria-invalid=true and aria-describedby pointing to a role=alert element.
  - Test: 429 MAX_ATTEMPTS shows the localised lockout string.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; keep server message as fallback for unknown codes.

### GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-05  ·  MEDIUM  ·  partly  ·  theme INPUT-VALIDATION (was PII)

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** The user’s email is echoed in ‘We sent a 6-digit code to …’ with no masking; acceptable on their own device but the ?ref parameter is reflected into the page from the URL without validating the APP-YYYY-XXXXXX format (LoginForm.tsx:11,77,112).
- **Verified evidence:** apps/web/src/app/careers/portal/login/LoginForm.tsx:108 echoes the typed email (the candidate's own input on their own device; masking is unnecessary). apps/web/src/app/careers/portal/login/LoginForm.tsx:11,77 reads ?ref and prints it in <strong>; React escapes it so there is no XSS, but arbitrary text (e.g. a phishing sentence) can be displayed inside a trusted-looking banner. The ref is only used to build the redirect (59, encodeURIComponent'd) and the portal page never reads it. Format from backend is APP-YYYY-XXXXXX (commands.ts:134) but other writers use APP-<8 hex> (eligibility-routes.ts:113).
- **Files to change:** `apps/web/src/app/careers/portal/login/LoginForm.tsx`
- **Fix steps:**
  1. Validate ref against /^APP-[A-Z0-9-]{4,20}$/ (accept both generator formats) and ignore it otherwise.
  2. Do not use <Masked>; not needed for the candidate's own email.
  3. Optionally mask the email as p***@domain in the confirmation line.
- **Acceptance:**
  - Test: ?ref=<any sentence> renders no banner.
  - Test: ?ref=APP-2026-AB12CD renders banner and redirect keeps ref.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; make the regex tolerant of both existing formats.

### GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-06  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** Suspense has no fallback and no loading.tsx, so the shell is blank until useSearchParams resolves (page.tsx:9-11).
- **Verified evidence:** apps/web/src/app/careers/portal/login/page.tsx:9-11 <Suspense> with no fallback; directory apps/web/src/app/careers has no loading.tsx or error.tsx (find). The fallback matters only briefly since LoginForm is a client component using useSearchParams.
- **Files to change:** `apps/web/src/app/careers/portal/login/page.tsx`, `apps/web/src/app/careers/portal/login/loading.tsx`
- **Fix steps:**
  1. Add a skeleton (header band + two grey blocks, matching LoginForm's 420px column) as <Suspense fallback>.
  2. Add loading.tsx under careers/portal for the portal list route.
  3. Add careers/error.tsx with retry and a link to /careers.
- **Acceptance:**
  - Throttled-network manual check shows skeleton instead of blank page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-07  ·  LOW  ·  confirmed  ·  theme A11Y (was PII)

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** Disabled OTP button (#94a3b8 on white) and hint text #94a3b8 fall under 4.5:1 contrast; ‘← Use a different email’ is 13px text-link styled as a button (LoginForm.tsx:98,125,129).
- **Verified evidence:** apps/web/src/app/careers/portal/login/LoginForm.tsx:99 hint uses #94a3b8 at 12px on white (about 2.6:1), apps/web/src/app/careers/portal/login/LoginForm.tsx:125 disabled button white text on #94a3b8 (about 2.6:1; disabled controls are exempt from WCAG but hard to read), apps/web/src/app/careers/portal/login/LoginForm.tsx:128-131 the 'Use a different email' control is a <button> styled as underlined link in #64748b 13px (contrast about 4.8:1, passes but small). The 'PII' theme tag is wrong.
- **Files to change:** `apps/web/src/app/careers/portal/login/LoginForm.tsx`
- **Fix steps:**
  1. Change hint text colour to #475569 or darker (>=4.5:1).
  2. Use a darker disabled background (e.g. #64748b) or a lighter disabled style with dark text.
  3. Raise the secondary action to 14px with min 44px hit area.
- **Acceptance:**
  - Contrast checker: hint text >= 4.5:1.
  - Secondary button hit area >= 44x44 px.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-08  ·  LOW  ·  confirmed  ·  theme COPY (was FABRICATED)

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** Placeholders ‘priya@example.com’ and ‘472839’ are examples, not hints of format; the 6-digit rule is only visible after the code is sent (LoginForm.tsx:90,117).
- **Verified evidence:** apps/web/src/app/careers/portal/login/LoginForm.tsx:90 placeholder 'e.g. priya@example.com' and :119 'e.g. 472839' are illustrative placeholders, not data; the hint at :100 already says 'A 6-digit code' on the email step, so the format rule is visible before the code is sent (observation is partly wrong there). A real-looking OTP placeholder may be mistaken for a value.
- **Files to change:** `apps/web/src/app/careers/portal/login/LoginForm.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Use a neutral placeholder ('name@example.com' -> keep) and '------' or '6 digits' for the OTP.
  2. Move placeholder strings to next-intl.
- **Acceptance:**
  - OTP field placeholder does not resemble a real code.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /hr/recruitment  —  `recruitment/home.html`

- **Source:** `apps/web/src/app/(app)/hr/recruitment/page.tsx`
- **Design reference:** `redesign/recruitment/home.html`

### GAP-RECRUITMENT-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** postedDate is rendered raw (ISO "2026-09-04") in the Posted column — DataTable has no date cellType and the page does not format it; talent-pool/page.tsx:85 formats the same kind of value with toLocaleDateString("en-IN"). apps/web/src/app/(app)/hr/recruitment/page.tsx:126
- **Verified evidence:** recruitment/page.tsx:126 defines column { key: 'postedDate', label: t('colPosted') } with no cellType. DataTable.tsx:47 supports only cellType 'status' | 'amount' | 'rupees'. The service returns postedDate as YYYY-MM-DD (queries.ts: r.postedAt ?? createdAt.slice(0,10)), so the cell prints '2026-09-04'. talent-pool/page.tsx:85 formats with toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }).
- **Files to change:** `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/hr/recruitment/page.tsx`
- **Fix steps:**
  1. Add cellType 'date' to DataTable's column type (DataTable.tsx:47) that renders via the shared date formatter but sorts and CSV-exports on the raw ISO (near DataTable.tsx:268-270).
  2. Set cellType: 'date' on the postedDate column (page.tsx:126); also add applicationDeadline column if useful.
  3. Use the same formatter as the detail page (see DETAIL-12).
- **Acceptance:**
  - Component test: DataTable date column shows the formatted date, sorts chronologically, and exports ISO.
  - Manual: hub Posted column matches the detail page format.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; DataTable is shared, keep the new cellType opt-in.
- **Depends on:** GAP-RECRUITMENT-DETAIL-12

### GAP-RECRUITMENT-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** A manager (ALL_ROLES) lands on this page with a working table but four all-zero stat cards and the chip "Some figures on this page couldn’t be loaded." — the 403 from GET /v1/hrms/recruitment/dashboard is a permanent role restriction, not a transient failure, yet the copy invites a retry. talent-pool/page.tsx:57–70 already handles status===403 with PermissionDenied; this page ignores `status`. apps/web/src/app/(app)/hr/recruitment/page.tsx:68–84; services/hrms-service/src/modules/recruitment/routes.ts:139–141
- **Verified evidence:** routes.ts:139-141 restricts GET /recruitment/dashboard to HR_ROLES while GET /job-openings allows ALL_ROLES including manager (routes.ts:22-25). Page.tsx:68-84 computes badgeMessage 'Some figures on this page couldn't be loaded.' (hard-coded English) for statsSource === 'error' but never reads the LoaderResult.status that fetchJson supplies (apiClient.ts sets status 403/errorCode). The four StatCards (page.tsx:102-107) get the empty fallback zeros, so a manager sees 0/0/0/0 next to a populated table. talent-pool/page.tsx:57-70 already special-cases status===403 with PermissionDenied.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Destructure status from getDashboard() and set const statsForbidden = statsSource === 'error' && status === 403.
  2. When statsForbidden, do not render the StatGrid with zeros; either omit it or derive the cards from the openings list (total = openings.length, open = status 'open', applications = sum applicationsReceived, published = count isPublished) so managers still get accurate department-scoped figures.
  3. Only show the retry-style badge for non-403 stats errors; move its text to an i18n key.
  4. Keep server enforcement unchanged (403 is correct).
- **Acceptance:**
  - Component test: dashboard 403 + openings 200 -> no zero cards and no 'couldn't be loaded' chip.
  - Component test: dashboard 500 -> chip still shown and cards render '—' instead of 0.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Deriving stats from the list is capped by limit=100 on this page's query; label as department view if used.

### GAP-RECRUITMENT-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** internshipsApprenticeships is fetched (DashboardStats, page.tsx:23) but no StatCard shows it, although the subtitle promises "internships, and apprenticeships" and the public page filters by these types. apps/web/src/app/(app)/hr/recruitment/page.tsx:102–107
- **Verified evidence:** DashboardStats declares internshipsApprenticeships (page.tsx:23) and the service computes it (routes.ts:150-151: vacancyType internship or apprenticeship only), but the StatGrid at page.tsx:102-107 renders four cards (total, open, applications, published) and never uses it. en.json recruitment.subtitle promises 'regular positions, internships, and apprenticeships'. Note the service count ignores the other types in VACANCY_TYPES (volunteership, contractual, deputation).
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add a fifth <StatCard> using stats.internshipsApprenticeships with new key recruitment.statInternshipsApprenticeships and an icon that exists in StatIcon.tsx.
  2. Show '—' when statsSource === 'error' (StatCard already renders null/NaN as '—', so pass null).
  3. Optionally add a vacancyType column to the table.
- **Acceptance:**
  - Component test: dashboard returns internshipsApprenticeships 3 -> card shows 3 with the new label.
  - Manual: creating an internship vacancy and refreshing increments the card.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-RECRUITMENT-NEW-01

### GAP-RECRUITMENT-HOME-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** No "Published" indicator in the list although queries.ts now returns isPublished (fixed specifically so the badge on the detail page works); HR cannot see from the hub which vacancies are live on /careers. services/hrms-service/src/modules/recruitment/queries.ts:46; apps/web/src/app/(app)/hr/recruitment/page.tsx:120–128
- **Verified evidence:** queries.ts:53-57 now returns isPublished: r.isPublished === true in every list row. recruitment/page.tsx Opening type (lines 26-36) omits it and the DataTable columns (page.tsx:120-128) are jobTitle, department, vacancies, applicationsReceived, postedDate, status - no published indicator. HR must open each vacancy to see whether it is live on /careers.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add isPublished?: boolean to the Opening type and map rows to include visibility: isPublished ? 'published' : 'unpublished'.
  2. Add a column { key: 'visibility', label: t('colPublished'), cellType: 'status' } and add 'published' (good) and 'unpublished' (mut) to STATUS_MAP in StatusPill.tsx.
  3. Optionally add a filter chip for Published only.
- **Acceptance:**
  - Component test: a row with isPublished true shows 'Published', false shows 'Unpublished'.
  - Manual: toggling publish on the detail page is reflected in the hub after refresh.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Reflects queued publish only after the consumer runs.
- **Depends on:** GAP-RECRUITMENT-DETAIL-07

### GAP-RECRUITMENT-HOME-05  ·  MEDIUM  ·  partly  ·  theme CHECKLIST (was OTHER)

- [x] **Status** — PR #1819 (merged)
- **First-pass claim:** ATS checklist gap (Recruitment & ATS, E2E-019 bulk recruitment): the hub has no advertisement / notification number, reservation roster status or fee configuration per vacancy even though the backend exposes PATCH /v1/hrms/job-openings/:id/advertisement and PUT …/reservation-roster (publication-routes.ts:40, reservation-routes.ts:35). Nothing in apps/web calls them.
- **Verified evidence:** Confirmed: PATCH /job-openings/:id/advertisement (publication-routes.ts:40) and PUT /job-openings/:id/reservation-roster (+ /approve, GET, reservation-shortlist; reservation-routes.ts:35-87) exist and no apps/web code calls them (grep negative). The hub table shows no fee or roster status. Overstated: the schema/routes have no separate advertisement or notification number - the only identifier is refNo (schema.ts and createJobOpeningBody have no such column; advertisement PATCH fields are fees, exemption, documents, selection process, dates, portal scope, alt title/description, min experience), so that item needs a backend field first. The list also does not return fee or roster status, so the hub cannot show it without extending the list payload.
- **Files to change:** `services/hrms-service/src/modules/recruitment/queries.ts`, `packages/schemas (JobOpeningSummarySchema)`, `apps/web/src/app/(app)/hr/recruitment/page.tsx`, `apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx`
- **Fix steps:**
  1. Backend: extend listJobOpenings with rosterStatus (from reservation repo findByJob, batch-loaded, not N+1) and feesMinor as string; decide whether to add an advertisementNo column.
  2. Web hub: add Reservation roster (Draft/Approved/None) and Fee columns using StatusPill and formatMoney (paise).
  3. Web detail: implement the roster editor and advertisement form (see DETAIL-13); the hub links to them.
- **Acceptance:**
  - Service test: list rows include rosterStatus for vacancies that have a roster and 'none' otherwise, with one batched query.
  - Manual: setting and approving a roster changes the hub badge.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Cross-module read: reservation lives in its own module, so the list must call its domain interface or read model, not join schemas (CLAUDE.md rule 4).
- **Depends on:** GAP-RECRUITMENT-DETAIL-13

### GAP-RECRUITMENT-HOME-06  ·  LOW  ·  partly  ·  theme I18N

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** Emoji-prefixed link labels ("🌐 View public careers page", "👥 Browse talent pool") and emoji StatCard icons come from en.json keys, so they are translated but not iconised consistently with the DS. apps/web/src/messages/en.json (recruitment.viewPublicCareersPage, browseTalentPool)
- **Verified evidence:** True for links: en.json:3824-3825 (recruitment.viewPublicCareersPage '🌐 View public careers page', browseTalentPool '👥 Browse talent pool') and hi.json:4580-4581 embed emoji in translated strings. Mis-described for StatCards: the emoji icons (📋 🟢 📨 🌐) are literals in recruitment/page.tsx:102-105, not en.json, and ds/StatIcon.tsx maps emoji to Lucide icons (only 📋 and 👥 are mapped among those used here; 🟢, 📨, 🌐 are not, so they fall back to raw emoji). EmptyState icon '💼' is also a literal (page.tsx:~113).
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`, `apps/web/src/app/(app)/hr/recruitment/page.tsx`, `apps/web/src/app/_components/ds/StatIcon.tsx`
- **Fix steps:**
  1. Remove the emoji from recruitment.viewPublicCareersPage and browseTalentPool in en.json and hi.json.
  2. Render lucide-react Globe and Users icons (aria-hidden) beside the Link text in page.tsx.
  3. Add mappings for the StatCard glyphs used (or switch to already-mapped ones) in StatIcon.tsx so no raw emoji renders; do the same for the '💼' EmptyState icon if EmptyState supports icon names.
- **Acceptance:**
  - Grep: no emoji code points remain in recruitment.* message values.
  - Manual: links and stat cards show Lucide icons in light and dark mode.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /hr/recruitment/[id]  —  `recruitment/detail.html`

- **Source:** `apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx`
- **Design reference:** `redesign/recruitment/detail.html`

### GAP-RECRUITMENT-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme WIRING (was CONFIRM)

- [x] **Status** — PR #1788 (merged)
- **First-pass claim:** refNo and vacancyType are read from the job-openings LIST payload (list-and-find, page.tsx:638–643), but queries.listJobOpenings never maps refNo or vacancyType (only id, jobTitle, department, vacancies, applicationDeadline, status, applicationsReceived, postedDate, isPublished). The header therefore prints " · Housing & Urban Development" with an empty reference, and the Type tile always says "Regular" — internships/apprenticeships are indistinguishable here. services/hrms-service/src/modules/recruitment/queries.ts:28–46; apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx:864,898. (JobOpeningSummarySchema lives in @civitasone/schemas, which is not in this checkout — could not confirm wheth
- **Verified evidence:** services/hrms-service/src/modules/recruitment/queries.ts:29-57 maps only id, jobTitle, department, vacancies, applicationDeadline, status, applicationsReceived, postedDate, isPublished - no refNo, no vacancyType (both exist on the row: queries.ts public mapper at ~62-70 reads r.refNo/r.vacancyType). Route routes.ts:22-39 pipes rows through sendValidated(JobOpeningSummaryListSchema) from @civitasone/schemas/web, which is not in the snapshot, so strip/passthrough is cannot-verify - but it does not matter, the service never emits the keys. page.tsx:636-643 fetches /job-openings?limit=200 and Array.find()s by id (no GET /job-openings/:id exists for HR; routes.ts only has list/create/applications). Header page.tsx:864 renders '{opening.refNo} · dept' -> ' · Housing...' and page.tsx:898 falls back to t('vacancyTypeRegular') for every row. Side effect: with more than 200 openings the target is not in the page and the screen says 'vacancy not found'.
- **Files to change:** `services/hrms-service/src/modules/recruitment/queries.ts`, `services/hrms-service/src/modules/recruitment/routes.ts`, `packages/schemas (JobOpeningSummarySchema in @civitasone/schemas/web - not in this checkout)`, `apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. In queries.listJobOpenings add refNo: r.refNo and vacancyType: r.vacancyType to the returned object (cache key list:{limit}:{dept} is unchanged; cached entries expire/invalidate naturally).
  2. Add refNo (string) and vacancyType (enum VACANCY_TYPES from validators.ts) to JobOpeningSummarySchema in @civitasone/schemas/web so sendValidated no longer strips them; update JobOpeningSummary type consumers (apps/web/src/app/_data/loaders.ts getJobOpenings).
  3. Preferred: add GET /v1/hrms/job-openings/:id in routes.ts (requireRole ALL_ROLES, same resolveDeptScope check, return the same summary shape plus refNo/vacancyType/location/payRange) and call it from loadOpening in page.tsx instead of list-and-find; treat 404 as not-found and other errors as the error state.
  4. In page.tsx:864 render refNo only when present (refNo ? `${refNo} · ` : ''); in the Type tile (page.tsx:898) map vacancyType through i18n keys vacancyType_regular / internship / apprenticeship / volunteership / contractual / deputation instead of showing the raw value, and show '—' if the field is missing rather than defaulting to Regular.
- **Acceptance:**
  - Service test: listJobOpenings for a row with refNo 'HUD/2026/014' and vacancyType 'internship' returns both keys, and the schema-validated HTTP response still contains them.
  - Component test: detail page with a summary payload {refNo:'HUD/2026/014', vacancyType:'internship'} shows 'HUD/2026/014 · Housing & Urban Development' and Type tile 'Internship'.
  - Manual: open an apprenticeship vacancy created via a JD template; Type tile shows Apprenticeship, not Regular.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low. Schema change is additive; the cached list payload changes shape so deploy service before web. Cannot confirm the schema package layout (not in snapshot).
- **Depends on:** GAP-RECRUITMENT-NEW-01

### GAP-RECRUITMENT-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme STAGE (was DEADROUTE)

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** The "Interview" pipeline stage counts stage==="interviewing", but no backend code ever writes that value (repo.ts:410–412 lists applied/shortlisted/offered/hired/rejected only; page.tsx:720–723 admits it) — the column is permanently 0 and scheduling an interview leaves the applicant in "Shortlisted". The STAGE_ACTIONS.interviewing branch (Send Offer disabled, "Offer management isn't available") is dead code. apps/web/src/app/(app)/hr/recruitment/_components/ApplicationPipeline.tsx:21; apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx:410–413
- **Verified evidence:** ApplicationPipeline.tsx:18-24 lists 'interviewing' as the third column and counts a.stage === key (line 27). Backend grep for stage writers finds only: commands.ts:145 / consumer.ts:88 / f3-consumer.ts:710 stage 'applied', repo.ts:92 'hired', repo.ts:116 'offered', plus shortlist/reject via screening (repo.ts:400-412 comment lists applied/shortlisted/offered/hired/rejected). Nothing writes 'interviewing' (and nothing writes 'selected' either). page.tsx:716-729 schedule_interview POSTs /v1/hrms/interviews and updates no application state, and its own comment (page.tsx:717-723) admits it. STAGE_ACTIONS.interviewing (page.tsx:410-413: disabled Send Offer with 'Offer management isn't available in this release yet', en.json:3909) is unreachable, and the reason text is also false since Send Offer works from Shortlisted.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/_components/ApplicationPipeline.tsx`, `apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx`, `apps/web/src/messages/en.json`, `services/hrms-service/src/modules/recruitment/interview-routes.ts (only if option A)`, `services/hrms-service/src/modules/recruitment/consumer.ts (only if option A)`
- **Fix steps:**
  1. Decide with product: (A) make scheduling move the application to stage 'interviewing' in the interview-create consumer (guarded by repo.NOT_OFFERABLE_STAGES and shortlisted-only, audit event emitted) or (B) drop the column.
  2. Option B (web only, recommended short-term): remove the 'interviewing' entry from ORDERED_STAGES in ApplicationPipeline.tsx and the unreachable STAGE_ACTIONS.interviewing branch and its en.json reason key in page.tsx; keep Send Offer enabled from Shortlisted as today.
  3. Option A: after ScheduleInterviewDialog success, reload applications (loadApplications) so the new stage shows; enable Send Offer in STAGE_ACTIONS.interviewing and delete the misleading disabledReason.
  4. Either way, show an 'Interview scheduled' hint on the row (from GET interviews for the application) so officers can see scheduling happened while stage remains shortlisted.
- **Acceptance:**
  - Component test: ApplicationPipeline renders exactly the stages the backend can produce (option B) and counts add up to the non-rejected/withdrawn total.
  - Option A service test: creating an interview for a shortlisted application results in stage 'interviewing' and a 409 for an already offered/hired one.
  - Manual: schedule an interview; the pipeline/row reflects it (stage change or explicit scheduled badge).
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Option A touches the offer/hire state machine (NOT_OFFERABLE_STAGES, claimApplicationForOffer, Hire dialog canHire); regression risk on offers. Option B is low risk.

### GAP-RECRUITMENT-DETAIL-04  ·  HIGH  ·  confirmed  ·  theme REASON (was CONFIRM)

- [x] **Status** — PR #1788 (merged)
- **First-pass claim:** Reject hard-wires reasonCode:"eligibility" for every rejection (page.tsx:697–701) although the backend defines eight structured reason codes and the ConfirmDialog could collect one (REJECTION_REASON_CODES, screening.ts:15–18). Audit trail records a wrong reason for skill/experience/document rejections. apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx:693–704
- **Verified evidence:** page.tsx:693-704: the 'reject' action always posts { decision: 'ineligible', reasonCode: 'eligibility' } to /screening-decision (comment at 694-696 acknowledges it is a stand-in). REJECT_CONFIRM (page.tsx:378-382) has no requireReason and ConfirmDialog (ds/ConfirmDialog.tsx) only collects one free-text reason and has no children/select slot, so reasonCode cannot be chosen. screening-routes.ts (z.object at ~line 75) accepts reasonCode: z.enum(REJECTION_REASON_CODES) (screening.ts:15-18: eligibility, skill, experience, qualification, incomplete_documents, duplicate, position_hold, other) plus optional remarks up to 2000 chars and requires a reasonCode for 'ineligible'. So every reject is recorded as an eligibility failure. Also handleAction ignores the ConfirmDialog reason for reject (reason only used for withdraw, page.tsx:680,708-711).
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx`, `apps/web/src/app/_components/ds/ConfirmDialog.tsx (optional children slot)`, `apps/web/src/lib/recruitment.ts (new: REJECTION_REASON_CODES list mirrored from screening.ts)`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Create apps/web/src/lib/recruitment.ts exporting REJECTION_REASON_CODES (same 8 values as services/.../screening.ts) and i18n keys rejectReason_<code>.
  2. Add an optional `children` (or `extraFields`) slot to ConfirmDialog that renders inside the panel above the reason box, or build a small RejectApplicationDialog in page.tsx using the same focus-trap pattern.
  3. In ContextMenu REJECT_CONFIRM use requireReason for remarks and render a required <select> of reason codes; onConfirm passes { reasonCode, remarks } to onAction.
  4. In handleAction 'reject' branch send { decision: 'ineligible', reasonCode: payload.reasonCode, remarks: payload.remarks }; keep the optimistic update only after res.ok.
  5. Disable the confirm button until a code is chosen.
- **Acceptance:**
  - Component test: choosing 'incomplete_documents' and confirming issues POST screening-decision with reasonCode 'incomplete_documents' and the typed remarks.
  - Component test: confirm is disabled until a reason code is picked.
  - Manual: reject an applicant with 'experience'; GET /applications/:id/screening-audit shows that code.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Audit-trail correctness for rejections (R-RA-0113/0119). Web must keep its code list in sync with the service enum (no shared package visible).

### GAP-RECRUITMENT-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1822 (merged)
- **First-pass claim:** Send Offer asks for "CTC (₹)" and converts rupees×100 to ctcMinor (page.tsx:296,305). For a Govt/PSU edition an offer is a 7th-CPC pay level + cell / IDA scale, and the richer offer workflow (POST …/offers → submit/approve/release/accept, offer-routes.ts:70–220) is bypassed by the single-field PATCH …/offer. apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx:278–359
- **Verified evidence:** True: SendOfferDialog (page.tsx:278-359) has a single 'CTC (₹)' number input, converts with Math.round(Number(x)*100) (page.tsx:296) and PATCHes /v1/hrms/applications/:id/offer with { ctcMinor, currency: 'INR', joiningDate } (handleAction page.tsx:730-748). The service accepts that (validators.ts:83-87 offerApplicationBody, integer ctcMinor) and claims the application to stage 'offered' (repo.ts:116). The richer workflow POST /applications/:id/offers -> submit/approve/release/accept (offer-routes.ts:70-220) with a DEFAULT_OFFER_CHAIN (HR/Finance/Legal/Competent Authority) is never called from apps/web (grep of apps/web for /offers finds nothing), so the PATCH path skips maker-checker approval. Overstated: the rupees-to-paise arithmetic is rounded and yields an integer so it is not a money-correctness bug, and the richer offer workflow does not model a 7th-CPC pay level/cell either (compBody has basicMinor, joiningBonusMinor, relocationMinor, variablePayMinor, grade, templateRef, joiningDate).
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx`, `apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx (offer status panel)`, `apps/web/src/lib/money.ts (reuse rupeesToMinorString)`, `services/hrms-service/src/modules/recruitment/offer-routes.ts (only if pay level/cell is added)`
- **Fix steps:**
  1. Decision first: for Govt/PSU editions route offers through POST /applications/:id/offers (draft) then submit/approve/release, not the single-field PATCH; keep PATCH only for Small Office edition or retire it.
  2. Replace SendOfferDialog's CTC field with basic pay (and optional bonus/relocation/variable) plus grade; convert with rupeesToMinorString from lib/money.ts and Number() the result (service wants a number) instead of Math.round(Number()*100); reject more than 2 decimals.
  3. Show the resulting offer status (draft/pending approval/approved/released) and a link to submit/approve on the application detail page using GET /applications/:id/offers.
  4. If Govt editions need pay level + cell, add payLevel/payCell fields to compBody and the offer table (backend + migration), sourced from the pay-matrix module (apps/web hr/pay-matrix) rather than free text.
- **Acceptance:**
  - Unit test: '56100.5' -> '5610050' paise, '1.005' rejected, '0' rejected.
  - Component test: sending an offer from the dialog calls POST /applications/:id/offers and shows status 'draft', not stage 'offered'.
  - Manual: an offer cannot be released until the approval chain approves it; approver cannot be the creator.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** High business risk: today HR can move a candidate to 'offered' and release compensation without approval. Changing the flow alters stage transitions the Hire dialog relies on (canHire stage selected|offered).

### GAP-RECRUITMENT-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme PICKER (was CONFIRM)

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** Interviewer(s) must be typed as comma-separated employee UUIDs (page.tsx:199–206) — no employee picker, although the Hire dialog on the application page already loads departments/designations by name. apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx:144,199–206
- **Verified evidence:** ScheduleInterviewDialog keeps interviewerIds as a plain string (page.tsx:133), splits on commas (page.tsx:144) and renders a text input with placeholder 'e.g. 3fa85f64-...' and help 'Comma-separated employee UUIDs.' (page.tsx:199-206, en.json:3922-3924). Backend interview-routes.ts:26 requires z.array(z.string().uuid()).min(1). After success InterviewCard is given interviewerName = ids.join(', ') (page.tsx:192), so UUIDs are also displayed back. A name-based pattern exists elsewhere (application detail Hire dialog loads /hrms/departments and /hrms/designations; other forms fetch /hrms/employees) but no shared EntityPicker/EmployeePicker component exists in apps/web. Typos only surface as a server error after submit.
- **Files to change:** `apps/web/src/app/_components/ds/EntityPicker.tsx (new, exported from ds/index.ts)`, `apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Create a reusable multi-select EntityPicker in ds (props: fetchUrl, mapItem -> {id,label,sub}, value: string[], onChange, minSelected) with type-ahead over GET /api/proxy/v1/hrms/employees?limit=... (check the exact query params used in hr/employees/page.tsx).
  2. Replace the interviewerIds text input in ScheduleInterviewDialog with EntityPicker; keep interviewerIds string[] of UUIDs in state and the payload unchanged.
  3. Store selected labels so InterviewCard receives names (interviewerName: labels.join(', ')) instead of UUIDs.
  4. Show a load-failure state with retry in the picker; do not fall back to raw UUID entry.
- **Acceptance:**
  - Component test: typing 'sharma' lists matching employees; selecting two produces payload.interviewerIds with two UUIDs.
  - Component test: submit disabled with zero interviewers.
  - Manual: success card shows interviewer names, no UUIDs.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low. Reusable picker also fixes UUID entry elsewhere (see NEW-08); interviewer must stay within dept-scope checks the service already enforces.

### GAP-RECRUITMENT-DETAIL-07  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** Raw enum values are shown to users as pills: opening.status ("open"), app.stage ("shortlisted"), app.screeningDecision ("manual_review") — STAGE_COLOR/DECISION_COLOR only colour them; StatusPill/humanizeStatus is not used. apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx:871–873,1018–1023
- **Verified evidence:** page.tsx:871-873 prints {opening.status} inside a span coloured via STAGE_COLOR (a map of application stages, so 'open'/'closed'/'on_hold' fall to the default grey; 'open' is never green). page.tsx:1018-1023 prints {app.stage} and {app.screeningDecision} raw ('shortlisted', 'manual_review', 'ineligible'), coloured by STAGE_COLOR/DECISION_COLOR (lines 55-73) with no dark-mode variants. ds/StatusPill.tsx would humanize (humanizeStatus) but its STATUS_MAP has no shortlisted/interviewing/offered/hired/withdrawn/eligible/ineligible/waitlisted/manual_review/on_hold entries so those would render as neutral 'info'. The hub (recruitment/page.tsx:127) already uses cellType 'status' -> StatusPill.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx`
- **Fix steps:**
  1. Extend STATUS_MAP in StatusPill.tsx with: shortlisted/eligible/selected -> info or good, offered -> warn, hired -> good, on_hold/waitlisted/manual_review -> warn, ineligible/withdrawn -> bad/mut.
  2. Replace the three inline spans in page.tsx (opening.status at 871, app.stage and app.screeningDecision at 1018-1023) with <StatusPill status={...} />; optionally pass i18n label prop for translated text.
  3. Delete STAGE_COLOR/DECISION_COLOR (still used by nothing else once replaced).
- **Acceptance:**
  - Unit test: StatusPill renders 'Manual review' for 'manual_review' and 'On hold' for 'on_hold' with the expected variant class.
  - Manual: header shows 'Open' pill and rows show 'Shortlisted' / 'Manual review'; no snake_case visible in light or dark mode.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; StatusPill is shared so added map keys change tone for other screens using the same words (check 'offered'/'hired' usages).

### GAP-RECRUITMENT-DETAIL-08  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** — PR #1822 (merged)
- **First-pass claim:** DPDP: every applicant's email and mobile are printed in the inbox list for any HR role with no masking; the blind-screening list the backend offers (GET …/blind-list, screening-routes.ts:245) is not used. apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx:996–998
- **Verified evidence:** True: page.tsx:996-998 prints {app.email} and ' · {app.mobile}' unmasked for every applicant, and the search box also matches email (page.tsx:823). The list endpoint (routes.ts:108-135) returns email/mobile in full, is HR-only (requireRole HR_ROLES = hr_admin, hr_officer, super_admin), and GET /job-openings/:id/blind-list (screening-routes.ts:245-251, redactApplicant strips PROTECTED_FIELDS incl. applicantName, email, mobile, category, gender, DOB, resume) is not called by any apps/web code. Overstated: the viewers are exactly the screening officers who need contact details, and blind-list is a whole-row anonymisation mode, not a masking variant; there is no shared <Masked> component in apps/web (only ad-hoc maskPhone in telephony/calls/page.tsx:37), and docs/SECURITY.md is not in the snapshot so the exact DPDP rule cannot be checked.
- **Files to change:** `apps/web/src/app/_components/ds/Masked.tsx (new)`, `apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx`, `services/hrms-service/src/modules/recruitment/routes.ts (audited reveal, if required)`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Decide the policy: mask contact details by default in the inbox and reveal per row for HR roles, or accept as-is for HR_ROLES and only add a Blind screening mode.
  2. Create ds/Masked.tsx (maskEmail 'a***@d***.gov.in', maskMobile '******4321') with a reveal button (aria-pressed) that reveals for the session and calls an audited endpoint (new POST /applications/:id/reveal-contact emitting an audit event) so reveals are logged.
  3. Use <Masked> at page.tsx:996-998 and keep email searchable only server-side or after reveal (page.tsx:823 currently searches the raw email).
  4. Add a 'Blind screening' toggle that loads GET /job-openings/:id/blind-list, hides name/email/mobile/category and keeps stage actions keyed by application id.
- **Acceptance:**
  - Component test: default render shows masked email/mobile; clicking Reveal shows full values and fires the audit call.
  - Component test: blind mode renders no applicantName/email/mobile and actions still work.
  - Service test: reveal endpoint emits an audit event and 403s non-HR roles.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII/DPDP. Client-side masking alone is cosmetic because the payload still contains full values; real control needs server-side audit/redaction. Masking removes email search unless server search is added.

### GAP-RECRUITMENT-DETAIL-09  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** "Shortlist All Pending (n)" fires n parallel POSTs with no confirmation and swallows partial failures (.catch(() => {})) — the officer only learns of failures row by row. The backend has a batch POST …/job-openings/:id/shortlist and …/shortlist/freeze (screening-routes.ts:203,234) that this button does not use. apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx:1047–1073
- **Verified evidence:** page.tsx:1047-1073: the button filters applications with screeningDecision 'pending' and stage 'applied' and runs Promise.all(pending.map(a => handleAction(a.id,'shortlist'))).catch(() => {}) with no confirmation. handleAction (page.tsx:684-691) makes one POST /applications/:id/screening-decision per row and throws on failure, setting decisionStates[appId]='error'. That error text is only rendered inside the row's open action menu (page.tsx:528-530), so failures are invisible unless each menu is opened; Promise.all rejects on the first failure and the catch swallows it. Backend has POST /job-openings/:id/shortlist { applicationIds (1-500) } returning { shortlisted, skipped, requested } (screening-routes.ts:203-231, HR_ROLES, skips frozen and BULK_SHORTLIST_BLOCKED) and POST .../shortlist/freeze (ADMIN_ROLES, 234-241), neither used in apps/web. The bulk route is queued (publishF3Write), so the UI must reload rather than assume success.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Wrap the button in useConfirmAction/ConfirmDialog: 'Shortlist N pending applicants? This can be reversed only via override.' with the count.
  2. Replace the Promise.all loop with a single POST /api/proxy/v1/hrms/job-openings/${id}/shortlist { applicationIds }, chunking at 500.
  3. Show the response { shortlisted, skipped, requested } in a result banner (skipped = frozen/blocked) and on failure show RefreshErrorState-style error with retry; do not swallow.
  4. After the 202/200 call loadApplications() (optionally poll once after ~1s) instead of optimistic per-row updates; keep shortlistAllBusy guard.
  5. Optionally add an admin-only 'Freeze shortlist' action behind its own ConfirmDialog (ADMIN_ROLES) using /shortlist/freeze.
- **Acceptance:**
  - Component test: clicking the button opens a confirm dialog; cancel sends no request.
  - Component test: confirm sends exactly one POST with all pending ids and renders 'Shortlisted 8, skipped 2'.
  - Component test: a 500 response shows a visible error banner and re-enables the button.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Bulk state change to candidates (shortlist is a screening decision with an override-only reversal, R-RA-0111). Bulk route is async so counts are pre-computed by the route, not confirmed writes.

### GAP-RECRUITMENT-DETAIL-10  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** Publish/Unpublish has no confirmation and the optimistic flip is not reverted if the queued 202 command later fails; publishing to /careers is a public act. apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx:794–817
- **Verified evidence:** handleTogglePublish (page.tsx:794-817) fires PATCH /job-openings/:id/publish immediately from the header button (page.tsx:874-886) with no confirmation. Precisely: it does not flip before the request; it flips local isPublished (page.tsx:809) after any res.ok, but the route (publication-routes.ts:115-124, HR_ROLES) only queues publishF3Write and replies { status: 'accepted' }, so a later consumer failure is never reflected and the badge stays wrong until reload. The list that feeds this page is cached (queries.listJobOpenings via cache.listOrLoad), so a reload right after may also show the old value. Publishing exposes the vacancy on /careers (queries.listPublishedVacancies) and there is no pre-check that the vacancy is open or complete.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Use ConfirmDialog (useConfirmAction) for both directions: publish text warns it becomes visible on the public careers page; unpublish warns applicants can no longer apply; danger tone for unpublish.
  2. Change the success handling to a 'pending' state: show 'Publishing...' badge and re-fetch loadOpening() after a short delay (and on window focus) until isPublished matches, with a timeout message 'Still processing - refresh' instead of assuming success.
  3. Disable Publish when opening.status !== 'open' or applicationDeadline is in the past, with a tooltip explaining why.
- **Acceptance:**
  - Component test: clicking Publish opens a dialog and sends no request until confirmed.
  - Component test: 202 response leaves the badge in 'Publishing...' until a subsequent GET returns isPublished true; if it never does, an alert appears.
  - Manual: unpublish requires confirmation and the vacancy disappears from /careers.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Public-facing action; wrong displayed state could mislead HR about whether a vacancy is live.

### GAP-RECRUITMENT-DETAIL-11  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** With appsLoadError the pipeline still renders five zeros (only categoryDataAvailable is gated), so a failed fetch reads as "0 received" above the error box. apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx:917–923,960–963
- **Verified evidence:** loadApplications sets appsLoadError and leaves applications=[] (page.tsx:654-666). The pipeline is gated only by !loadingApps (page.tsx:917-923), so on failure ApplicationPipeline (ApplicationPipeline.tsx:26-29) shows 0 in all five columns. Same masking: the Applications meta tile shows applications.length = 0 (page.tsx:899), and the inbox header badge shows '0 / 0' (page.tsx:930-934); the error box (ErrorState with onRetry, page.tsx:960-963) appears only further down. GOIReservationCard is already gated via appsLoadError (page.tsx:603-617). Note: RefreshErrorState has no retry prop (only onBack/backHref/helpHref), so keep ErrorState with onRetry here rather than the suggested RefreshErrorState.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx`
- **Fix steps:**
  1. Change the pipeline gate at page.tsx:917 to {!loadingApps && !appsLoadError && (...)}.
  2. At page.tsx:899 use value: loadingApps || appsLoadError ? '—' : applications.length.
  3. Hide the '{filtered.length} / {applications.length}' badge (page.tsx:930) when appsLoadError.
  4. Optionally move the ErrorState above the pipeline so the failure is the first thing seen.
- **Acceptance:**
  - Component test: applications fetch returns 500 -> no pipeline counts rendered, Applications tile shows '—', ErrorState with Retry visible.
  - Component test: successful retry shows real counts.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-RECRUITMENT-DETAIL-12  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT (was DEADROUTE)

- [x] **Status** — PR #1799 (merged)
- **First-pass claim:** Vacancy meta Deadline uses toLocaleDateString("en-IN") → "30/9/2026" while the hub prints ISO and the talent pool prints "30 Sept 2026"; three date formats across one module. apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx:900
- **Verified evidence:** page.tsx:900 (Deadline tile) and page.tsx:1026 (appliedAt per row) use toLocaleDateString('en-IN') with no options, which yields numeric non-padded '30/9/2026'. Hub recruitment/page.tsx:126 shows postedDate raw ISO (see HOME-01) and talent-pool/page.tsx:85 uses en-IN with { day:'numeric', month:'short', year:'numeric' }. So three formats in one module. The shared helper lib/formatters.ts formatIndianDate() yields zero-padded 'dd/MM/yyyy' (not 'dd Mon yyyy' as the suggested fix says) and does not set timeZone. The original theme tag DEADROUTE is wrong.
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx`, `apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx`, `apps/web/src/app/(app)/hr/recruitment/page.tsx`
- **Fix steps:**
  1. Agree one display format for the module (GFR/PFMS comment in formatters.ts says dd/MM/yyyy; the fix note says dd Mon yyyy) and put it in lib/formatters.ts as formatIndianDate (extend with a style option or add formatIndianDateLong) using timeZone 'Asia/Kolkata'.
  2. Replace the two toLocaleDateString calls in [id]/page.tsx (lines 900, 1026) and the one in talent-pool/page.tsx:85 with the helper.
  3. Handle date-only strings (closesAt/postedDate are YYYY-MM-DD) without timezone shift.
- **Acceptance:**
  - Unit test: formatter returns the agreed string for '2026-09-30' and '2026-09-30T18:45:00Z' (IST rolls to 1 Oct).
  - Manual: hub, detail and talent pool show identical date format for the same vacancy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; changing formatIndianDate output itself would affect every screen - add a new option instead.
- **Depends on:** GAP-RECRUITMENT-HOME-01

### GAP-RECRUITMENT-DETAIL-13  ·  MEDIUM  ·  confirmed  ·  theme CHECKLIST (was DATEFMT)

- [x] **Status** — PR #1822 (merged)
- **First-pass claim:** Checklist gap — advertisement / DoPT-style notification: fee, fee exemption, required documents, important dates, portal scope and corrigenda are settable only via PATCH …/advertisement and POST …/corrigendum|extend|cancel (publication-routes.ts:40–125); the page exposes none of it, and application fee status (application-fee-routes.ts:42–115, R-RA-0099) is invisible to the screening officer.
- **Verified evidence:** publication-routes.ts:40-125 defines PATCH /job-openings/:id/advertisement (feesMinor, feeExemption, requiredDocuments, selectionProcess, importantDates, portalScope, titleAlt, descriptionAlt, minExperienceYears; the deadline is deliberately excluded and must go through /extend), POST /corrigendum, /extend, /cancel and GET /corrigenda. application-fee-routes.ts:42,76,115 has fee/assess, fee/pay (manual offline payment) and GET fee status. A grep of apps/web for these paths (advertisement, corrigend, extend, cancel, /fee) returns no callers; the detail page only calls list, applications, screening-decision, withdraw, interviews, offer, publish. So none is reachable from the UI. Money is bigint paise (feesMinor). The original theme tag DATEFMT is wrong.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx (tabs: Advertisement, Corrigenda)`, `apps/web/src/app/(app)/hr/recruitment/[id]/_components/AdvertisementPanel.tsx (new)`, `apps/web/src/app/(app)/hr/recruitment/[id]/_components/CorrigendumPanel.tsx (new)`, `apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx (fee status)`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add a Tabs layout (ds/Tabs) to the detail page: Applications | Advertisement | Corrigenda.
  2. AdvertisementPanel: form for fee (rupees converted with rupeesToMinorString to feesMinor), fee exemption text, required documents list, important dates, portal scope select; PATCH /advertisement; read-only after publish except via corrigendum.
  3. CorrigendumPanel: list via GET /corrigenda; actions Corrigendum, Extend deadline (forward-only date), Cancel vacancy each in ConfirmDialog with mandatory reason.
  4. On each application row/detail show fee status from GET /applications/:id/fee with assess/pay-record actions for offline payment (UTR/challan ref).
  5. Confirm response shapes with the service before typing them (routes reply from queued writes).
- **Acceptance:**
  - Component test: saving advertisement sends feesMinor as integer paise (500.00 -> 50000).
  - Component test: extend rejects a date earlier than current deadline client-side and shows server 4xx errors.
  - Manual: after cancel, vacancy status shows Closed and /careers no longer lists it.
- **Needs:** web  ·  **Effort:** L >2d  ·  **Risk:** Statutory content (fees, deadline extension, cancellation) goes public; needs role checks matching service HR_ROLES/ADMIN_ROLES and audit via consumers. Fee handling is money in paise.
- **Depends on:** GAP-RECRUITMENT-DETAIL-10

### GAP-RECRUITMENT-DETAIL-14  ·  MEDIUM  ·  partly  ·  theme CHECKLIST (was LOADING)

- [x] **Status** — PR #1822 (merged)
- **First-pass claim:** No admit card / hall ticket, written-test result or selection-list (merit/wait list) step in the UI, although selection-routes.ts:41–145 and result-routes.ts:55–208 exist; the pipeline jumps from Shortlisted straight to Offer. services/hrms-service/src/modules/recruitment/selection-routes.ts:41
- **Verified evidence:** True for selection lists and results: selection-routes.ts has POST /job-openings/:id/selection-lists (41), PUT entries, approve, publish, expire and GET (52-145) and result-routes.ts covers manual-queue, evaluations, consolidate, moderate, freeze, publish and result (55-208); attempt-routes.ts adds assessment schedules and attempts. None is referenced from apps/web (grep for selection-lists and hrms/assessments returns nothing), so the pipeline goes Shortlisted -> Offer. Not confirmed: an admit card / hall ticket. No route with that name exists in the hrms recruitment module (only otp-verify/candidate-public-auth mention 'admit' text), so that part needs a backend endpoint first. The original theme tag LOADING is wrong.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/[id]/page.tsx`, `apps/web/src/app/(app)/hr/recruitment/[id]/selection/page.tsx (new)`, `apps/web/src/app/(app)/hr/recruitment/[id]/results/page.tsx (new)`, `apps/web/src/app/(app)/hr/recruitment/_components/ApplicationPipeline.tsx`
- **Fix steps:**
  1. Add sub-routes /hr/recruitment/[id]/selection (list via GET /job-openings/:id/selection-lists, entries PUT, approve, publish, expire with maker-checker via the service) and /results (assessment schedules/attempts and result publish).
  2. Link them from the detail page header and extend ApplicationPipeline with Assessment and Selected stages fed from the service rather than hard-coded (see DETAIL-02).
  3. Raise a backend ticket for an admit-card generator endpoint (candidate + schedule + roll number PDF) before promising it in the UI.
  4. Reuse ConfirmDialog with mandatory reason for approve/publish/expire.
- **Acceptance:**
  - Manual: an approved selection list can be created, approved by a second user and published from the UI.
  - Component test: maker cannot approve their own list (service returns 4xx, UI shows message).
  - Admit card acceptance deferred until backend exists.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Selection/result publication is a statutory merit outcome; SoD and audit must remain enforced by the service.
- **Depends on:** GAP-RECRUITMENT-DETAIL-02


---
## /hr/recruitment/[id]/applications/[appId]  —  `recruitment/detail-applications-application.html`

- **Source:** `apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx`
- **Design reference:** `redesign/recruitment/detail-applications-application.html`

### GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-01  ·  HIGH  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1788 (merged)
- **First-pass claim:** Basic Pay is entered in paise ("in paise" placeholder, hint "amount in paise") under a "Basic Pay (₹)" label — an HR officer typing 56100 will hire at ₹561.00. No rupee→paise conversion, no 7th-CPC level/cell picker. apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx:296–311
- **Verified evidence:** apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx:296-311 label t('basicPay') is 'Basic Pay (₹)' (en.json recruitmentApplicationDetail.basicPay), placeholder 'in paise', hint 'amount in paise'; the state is basicMinor (number) sent as-is at line 198. Backend requires z.number().int().positive() paise (validators.ts:95). Typing 56100 hires at Rs 561.00. No level/cell picker exists.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx`, `apps/web/src/lib/money.ts`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Create shared apps/web/src/lib/money.ts with parseRupeesToPaise(string) (string-based, no float, rejects >2 decimals) and formatINR(paise); replace the local copy in JournalEntryForm.tsx:31 later.
  2. Change the field to a rupee input (inputMode decimal); keep state as string and convert with parseRupeesToPaise in handleHire.
  3. Show a live preview under the field: formatINR(paise) e.g. 'Rs 56,100.00 (5610000 paise)'.
  4. Change label/placeholder/hint keys to rupees.
  5. Optional follow-up: pay-level/cell picker if a 7th-CPC master exists (not verified).
- **Acceptance:**
  - Unit test: '56100' -> 5610000; '56100.5' -> 5610050; '1.234' rejected.
  - Component test: submitting 56100 POSTs basicMinor 5610000.
  - Preview text visible before confirm.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money: mis-conversion would create wrong salary records; unit-test the helper and double-check with existing rupee-field forms.

### GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1788 (merged)
- **First-pass claim:** Raw values shown to users: Application ID as a bare UUID in <code>, Source "public_portal", Applied as the unformatted ISO timestamp (no toLocaleDateString), stage/decision only CSS-capitalised. apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx:262–269
- **Verified evidence:** apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx:262 prints application.id in <code>; :263-264 stage and screeningDecision only capitalised via CSS (raw 'offered', 'pending', or 'selected'); :265 raw source e.g. 'public_portal'; :269 raw ISO appliedAt. Backend list response has no applicationNo (routes.ts:112-126), so the human-readable APP-... number is unavailable to the page.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx`, `services/hrms-service/src/modules/recruitment/routes.ts`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Backend: add applicationNo to the mapped list rows in routes.ts:112.
  2. Show applicationNo (fallback: hide the row) instead of the UUID; keep id only in the URL.
  3. Format appliedAt with Intl.DateTimeFormat in the tenant locale (dd MMM yyyy, IST).
  4. Map stage, screeningDecision and source through next-intl enum keys with a raw-value fallback.
- **Acceptance:**
  - Test: appliedAt '2026-03-01T10:00:00Z' renders '1 Mar 2026'.
  - No UUID visible on the page.
  - source 'public_portal' renders 'Public careers portal'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-03  ·  MEDIUM  ·  partly  ·  theme OPTIMISTIC-UI (was CONFIRM)

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** "Hire" has no ConfirmDialog step beyond the form itself and the optimistic stage → hired is never reverted if the queued 202 command fails downstream (assertKnownEngagementType, duplicate employeeNo). apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx:195–209
- **Verified evidence:** apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx:175-214 the 'Confirm Hire' button of a modal form (alertdialog with description) is the confirmation step; a separate ConfirmDialog with reason is arguably redundant. assertKnownEngagementType runs synchronously in the route (routes.ts:187) before returning 202, so the observation is wrong there. Real issue: on 202 the UI sets stage 'hired' locally (line 208) although the consumer can still fail and roll back (NO_VACANCY_AVAILABLE, DEPARTMENT_NOT_FOUND, DESIGNATION_NOT_FOUND in consumer.ts:~245-256), leaving the application in its pre-hire stage; I found no explicit duplicate employeeNo check in the consumer (cannot verify DB uniqueness).
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx`
- **Fix steps:**
  1. On 202 set a 'hirePending' state and show 'Hire queued, processing' rather than stage 'hired'.
  2. Refetch the application list after a few seconds (or on window focus) and derive stage from server data.
  3. If the refetched stage is still selected/offered after N retries, show a 'Hire did not complete, check with an administrator' warning.
  4. Optional: add a summary line (employee no, dept, designation, pay) to the dialog before submit.
- **Acceptance:**
  - Test: after 202 the chip does not say 'hired' until refetch returns hired.
  - Test: consumer failure scenario shows the warning.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** HR could believe a hire completed when it did not; hire creates an employee and payroll data.

### GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-04  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** Labels read "Department ID" / "Designation ID" (en.json recruitmentApplicationDetail.departmentId) even when name dropdowns are shown; the UUID fallback inputs are unlabeled as such. apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx:315–339
- **Verified evidence:** apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx:315,328 labels use t('departmentId') 'Department ID' and t('designationId') 'Designation ID' (en.json) even when the name <select> renders (316-322, 329-335); the fallback text inputs at 324 and 337 show placeholder 'UUID'. Load failures are swallowed (line 128-131), so an API failure silently turns the field into a UUID box. Also 'Select department…' (318) and 'Select designation…' (331) are hard-coded English.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Rename keys/labels to 'Department' and 'Designation'.
  2. Replace the UUID fallback inputs with a disabled select plus an inline error 'Could not load departments' with a Retry button.
  3. Move the option placeholders to next-intl keys.
  4. Where available, use the shared EntityPicker/SmartCombobox (app/_components/SmartCombobox.tsx) for search.
- **Acceptance:**
  - Labels read Department/Designation.
  - With departments API 500, no UUID text box appears; retry loads the list.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; hire requires valid UUIDs, so never allow free-text entry.

### GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-05  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** No GET /v1/hrms/applications/:id — the page downloads every application of the vacancy (PII of all applicants) to display one. services/hrms-service/src/modules/recruitment/routes.ts:108; apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx:73–85
- **Verified evidence:** apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx:78 fetches GET /v1/hrms/job-openings/:id/applications and .find()s by appId (85). services/hrms-service/src/modules/recruitment/routes.ts:108-130 returns the full list including name, email, mobile, skills, qualification for every applicant; no singular GET /v1/hrms/applications/:id exists (grep of routes). The list is HR_ROLES-gated (requireRole), so exposure is to authorised HR users only, but the payload grows with the vacancy and is unmasked.
- **Files to change:** `services/hrms-service/src/modules/recruitment/routes.ts`, `services/hrms-service/src/modules/recruitment/queries.ts`, `apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx`
- **Fix steps:**
  1. Add GET /v1/hrms/applications/:id (HR_ROLES, idParam zod) using repo.findApplicationById (already used at routes.ts:~184) via the cache read-through helper.
  2. Return the same field set as the list plus applicationNo, category, dateOfBirth if permitted.
  3. Switch the page to fetch /api/proxy/v1/hrms/applications/${appId}; treat 404 as not-found and other errors as errors.
  4. Emit a read-audit entry if the tenant treats applicant PII views as auditable (decision).
- **Acceptance:**
  - Integration test: 200 for an HR user, 403 for others, 404 for a foreign-tenant id.
  - Network panel shows a single-record response on the page.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** New endpoint touches applicant PII; keep tenant scoping and role check identical to the list route.
- **Depends on:** GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-07

### GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-06  ·  MEDIUM  ·  partly  ·  theme COVERAGE (was I18N)

- [x] **Status** — PR #1819 (merged)
- **First-pass claim:** Checklist gaps for an application record (Recruitment & ATS; R-RA-0099 fee, R-RA-0105 application copy, R-RA-0082 reservation attributes): fee status, application PDF, category, DOB, résumé, interview scorecards and offer history are all persisted (schema.ts:55–95; application-fee-routes.ts; application-pdf-routes.ts; offer-routes.ts) but none is shown; the summary card has eight fields.
- **Verified evidence:** apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx:260-271 summary shows eight fields (id, stage, decision, source, email, qualification, experience, applied). Backing data exists: category and dateOfBirth columns and resume refs (schema.ts:55-70), fee GET (application-fee-routes.ts:115), PDF GET (application-pdf-routes.ts:27), offers GET (offer-routes.ts:100), and interview scoring routes. However the list endpoint returns category but not dateOfBirth, resume or fee, so the page would need new fetches. The R-RA checklist ids could not be checked (checklist source not in the snapshot).
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx`, `services/hrms-service/src/modules/recruitment/routes.ts`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. After the singular GET (-05) adds category, dateOfBirth and resume reference, render them in the summary card (DOB behind a role check).
  2. Add tabs or cards for Fee (GET /applications/:id/fee), Offers (GET /applications/:id/offers) and a 'Download application PDF' link (GET /applications/:id/pdf).
  3. Add an Interview scorecards section using the interview-scoring routes (confirm exact GET path before implementing).
  4. Each section loads independently with its own error state.
- **Acceptance:**
  - Fee status, offer status and PDF link visible for an application that has them.
  - A failing fee call shows a section error, not a blank.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Exposes DOB/category (PII, reservation data); restrict to HR roles and consider audit.
- **Depends on:** GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-05

### GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-07  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK (was DEADROUTE)

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** Not-found branch uses the DataSourceBadge with source "api" (no chip) and a bare sentence; no link back to the pipeline beyond the header back link, and the same layout is reused for real fetch failures with a different sentence — indistinguishable at a glance. apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx:224–234
- **Verified evidence:** apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx:224-234 one branch for both error and missing: title comes from t('notFoundTitle')/'Not found' even for fetch failures (setError at 81/93 with source 'error'), body is a single muted sentence; for true not-found source stays 'api' (line 87-88 sets only error) so no chip. A back link exists in PageHeader only (227). error.tsx and loading.tsx exist in the route dir but this branch bypasses them. The 'DEADROUTE' tag is wrong.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx`
- **Fix steps:**
  1. Split the branches: not-found (application absent from a successful list) gets its own title, message and a 'Back to pipeline' button.
  2. For fetch errors render the shared RefreshErrorState/RouteError with a Retry that re-runs load().
  3. Set source to 'error' only for real failures and hide the 'Not found' title there.
- **Acceptance:**
  - Test: 500 shows error state with Retry, not 'Not found'.
  - Test: valid list without the id shows not-found with back button.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-08  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** Back label "Back to Applications" is a hard-coded string, not a next-intl key, unlike every other label on the page. apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx:227,243
- **Verified evidence:** apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx:227 and :243 pass backLabel='Back to Applications' literally; also hard-coded 'Select department…' (318) and 'Select designation…' (331). The FABRICATED tag is wrong; this is untranslated copy.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/[id]/applications/[appId]/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Add keys backToApplications, selectDepartment, selectDesignation to recruitmentApplicationDetail.
  2. Use t() at lines 227, 243, 318, 331.
  3. Add the Hindi translations.
- **Acceptance:**
  - Locale switch to hi shows translated back link and select placeholders.
  - grep for literal strings in this file returns none.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /hr/recruitment/new  —  `recruitment/new.html`

- **Source:** `apps/web/src/app/(app)/hr/recruitment/new/page.tsx`
- **Design reference:** `redesign/recruitment/new.html`

### GAP-RECRUITMENT-NEW-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1788 (merged)
- **First-pass claim:** vacancyType has state and is sent in the body, but there is no input for it — every vacancy created from scratch is "regular"; internships, apprenticeships and volunteer roles (which the public page and the hub subtitle advertise) can only be created via a JD template. apps/web/src/app/(app)/hr/recruitment/new/NewJobOpeningForm.tsx:48,102,178
- **Verified evidence:** NewJobOpeningForm.tsx:48 declares vacancyType state (default 'regular'), it is only set from a JD template (line 102) and sent in the body (line 178), but the JSX (lines 233-395) has no vacancyType control. validators.ts:5 allows regular, internship, apprenticeship, volunteership, contractual, deputation. So a vacancy made from scratch is always 'regular'; hub dashboard and public page treat internship/apprenticeship specially.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/new/NewJobOpeningForm.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add a <select> after Title using the six VACANCY_TYPES values (define the list in apps/web/src/lib/recruitment.ts) with labels vacancyType_<value> in en.json.
  2. Bind it to vacancyType/setVacancyType; keep template prefill.
  3. Use the same labels on the detail Type tile (see DETAIL-01).
- **Acceptance:**
  - Component test: choosing 'internship' submits vacancyType 'internship' in the POST body.
  - Component test: template with vacancyType 'apprenticeship' preselects that option.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-RECRUITMENT-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme PAY (was VALIDATION)

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** Pay Range is free text ("Level 10, Rs 56,100 - 1,77,500") — no 7th-CPC pay level / pay matrix reference and no minor-unit money field, so it cannot drive the offer or hire basic pay; payRange is capped at 120 chars (validators.ts:15). apps/web/src/app/(app)/hr/recruitment/new/NewJobOpeningForm.tsx:342–354
- **Verified evidence:** NewJobOpeningForm.tsx:342-354 is a plain text input with placeholder 'e.g. Level 10, Rs 56,100 - 1,77,500' (en.json:4015), no maxLength. validators.ts:15 limits payRange to 120 chars and it is the only pay field on createJobOpeningBody, so nothing structured (level, min/max in paise) reaches the opening; the offer/hire paths use separate money inputs (offer ctcMinor, hire basicMinor). Over-length input is only rejected by the server after submit. Web has an hr/pay-matrix module that could supply levels (its API was not inspected).
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/new/NewJobOpeningForm.tsx`, `services/hrms-service/src/modules/recruitment/validators.ts`, `services/hrms-service/src/modules/recruitment/schema.ts (+ migration)`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Decision: keep payRange as display text but add structured optional fields payLevel (string), payMinMinor and payMaxMinor (bigint as string) to createJobOpeningBody, the drizzle schema and a migration.
  2. In the form add a Pay level select fed by the pay-matrix endpoint and min/max rupee inputs converted with rupeesToMinorString; auto-compose the payRange display string from them.
  3. Add maxLength={120} to the payRange input now (also title 256, qualification 500, description 5000, selectionProcess 3000) so limits are enforced before submit.
- **Acceptance:**
  - Component test: typing 121 chars in Pay Range is blocked/flagged inline.
  - Service test: payMinMinor > payMaxMinor returns 400; values persist as bigint minor units.
  - Manual: selecting Level 10 fills the range from the pay matrix.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money fields must be minor units end to end (CLAUDE.md rule 11); schema migration on a live table.

### GAP-RECRUITMENT-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** location, designationId, isPublished and postedAt are accepted by createJobOpeningBody (validators.ts:9,17–19) but have no inputs; a public advert without a location or posted date is incomplete for a DoPT-style notification. apps/web/src/app/(app)/hr/recruitment/new/NewJobOpeningForm.tsx:170–195
- **Verified evidence:** validators.ts:9-19 accepts designationId, location, isPublished and postedAt; the POST body in NewJobOpeningForm.tsx:170-195 sends none of them and the form has no inputs for them. Nuance: the hub falls back to createdAt for postedDate (queries.ts), but the public listing maps r.postedAt ?? undefined (queries.listPublishedVacancies), so /careers shows no posted date and location for these vacancies. A designations dropdown pattern already exists in applications/[appId]/page.tsx:118,329.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/new/NewJobOpeningForm.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add Location text input (max 200), Designation select (GET /api/proxy/v1/hrms/designations?limit=200, optional) and Posted date (type=date, default today, YYYY-MM-DD).
  2. Send location, designationId, postedAt in the body only when set; leave isPublished false and add helper text that publishing is done from the vacancy page.
  3. Add maxLength attributes matching validators.ts.
- **Acceptance:**
  - Component test: filling location and posted date includes them in the POST body; empty ones are omitted.
  - Manual: /careers lists the new vacancy with its location and posted date after publishing.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-RECRUITMENT-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was FAILMASK)

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** Validation is sequential (first failing field only) and the message is shown below the submit button, off-screen on mobile for a 10-field form; the invalid field is highlighted but not focused. apps/web/src/app/(app)/hr/recruitment/new/NewJobOpeningForm.tsx:132–163,399–413
- **Verified evidence:** handleSubmit (NewJobOpeningForm.tsx:132-163) returns on the first failing check (refNo, length, title, department UUID, vacancies) and sets a single invalidField/message. The message paragraph renders after the submit button (lines ~399-413), so on a long 10-field form on a phone it is below the fold; the invalid input only gets red border and aria-invalid, and no ref/focus() call moves focus. The form has noValidate, so native messages do not help. useFormError exposes fieldErrors from the backend VALIDATION_FAILED envelope but only the summary message is used. Validation is hand-written, not a zod schema.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/new/NewJobOpeningForm.tsx`, `apps/web/src/lib/recruitment.ts (zod schema mirroring createJobOpeningBody)`
- **Fix steps:**
  1. Create a zod schema mirroring createJobOpeningBody (lengths, uuid, positive int, date regex) and run safeParse on submit to build a fieldErrors map for all failing fields at once.
  2. Render each message under its field with id and aria-describedby, keep aria-invalid.
  3. Focus the first invalid field (document.getElementById or refs) and add an error summary at the top of the form with role='alert'.
  4. Merge server fieldErrors from formError (VALIDATION_FAILED) into the same map.
- **Acceptance:**
  - Component test: submitting empty form shows errors for refNo, title and department together and focuses Reference No.
  - Component test: server fieldErrors for 'payRange' show under Pay Range.
  - Manual on a 375px viewport: errors visible without scrolling to the bottom.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Keep schema in sync with the service validators (no shared package visible).

### GAP-RECRUITMENT-NEW-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** requiredDocuments and eligibility (incl. allowMultiple, which controls dedup on public apply — routes.ts:288–292) are carried from a template invisibly; HR cannot see or edit them before submitting. apps/web/src/app/(app)/hr/recruitment/new/NewJobOpeningForm.tsx:66–67,107–108,188–189
- **Verified evidence:** NewJobOpeningForm.tsx:66-67 hold requiredDocuments and eligibility in state, set only from the template fetch (lines 107-108) and sent as-is (lines 188-189); no JSX renders or edits them. Service routes.ts:278-292 reads eligibility.allowMultiple === true to decide whether public applicants may apply more than once per email. A from-scratch vacancy therefore has no required documents or eligibility, and a template-based one carries values HR never sees. The only other write path is PATCH /advertisement (requiredDocuments), which the UI does not call (see DETAIL-13).
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/new/NewJobOpeningForm.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add a Required documents list editor (add/remove rows, up to 30 items of max 200 chars) bound to requiredDocuments.
  2. Add an 'Allow multiple applications from the same email' checkbox that sets eligibility.allowMultiple while preserving other template keys via spread.
  3. Show a read-only summary of any other eligibility keys carried from the template (JSON key/value list) with a note that they are inherited.
  4. Send requiredDocuments only when non-empty.
- **Acceptance:**
  - Component test: template-provided documents appear as editable rows; removing one omits it from the POST.
  - Component test: ticking allowMultiple posts eligibility {allowMultiple:true, ...template keys}.
  - Manual: public apply dedup behaviour follows the checkbox.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Eligibility drives public duplicate-application handling; spreading must not drop template criteria.

### GAP-RECRUITMENT-NEW-06  ·  MEDIUM  ·  partly  ·  theme CHECKLIST (was OTHER)

- [x] **Status** — PR #1819 (merged)
- **First-pass claim:** Checklist gap — no requisition/sanctioned-post link (requisition-routes.ts exists), no reservation roster, no application fee / exemption, no advertisement number: the form creates a bare opening and the reviewer must hand-edit the rest through unexposed APIs. services/hrms-service/src/modules/recruitment/publication-routes.ts:40–66; services/hrms-service/src/modules/recruitment/reservation-routes.ts:35
- **Verified evidence:** Confirmed that routes exist and the UI ignores them: requisition-routes.ts (create, submit, approve, return, hold, cancel, close, clone, publish at 299), reservation-routes.ts:35 and publication-routes.ts:40; grep of apps/web finds no callers, and the form (NewJobOpeningForm.tsx) posts only to /job-openings. Mis-described: createJobOpeningBody has no requisition or sanctioned-post field, and there is no advertisement-number column, so the form cannot 'link' them. The intended government flow is requisition -> approvals -> POST /requisitions/:id/publish (ADMIN_ROLES, blocked until fully approved, R-RA-0056), which creates the opening; direct POST /job-openings bypasses that gate. Whether direct creation should stay allowed for Govt editions is a product decision.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/requisitions/page.tsx (new)`, `apps/web/src/app/(app)/hr/recruitment/new/page.tsx`, `services/hrms-service/src/modules/recruitment/routes.ts (edition gate on direct create, if decided)`
- **Fix steps:**
  1. Decide per edition whether direct vacancy creation is allowed or must originate from an approved requisition.
  2. Build the requisition list/create/approval screens on the existing /v1/hrms/requisitions routes and add a Publish action that calls POST /requisitions/:id/publish.
  3. On /hr/recruitment/new show a notice (or redirect) when the edition requires a requisition; optionally accept ?requisitionId= to prefill.
  4. After creation link HR to the roster (PUT reservation-roster) and advertisement panels (see DETAIL-13, HOME-05).
- **Acceptance:**
  - Manual: Govt edition cannot create a public vacancy without a fully approved requisition.
  - Service test: POST /job-openings returns 4xx for the requisition-only edition.
  - Component test: requisition publish returns publishedOpeningId and links to /hr/recruitment/[id].
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Bypassing requisition approval creates unsanctioned public vacancies; gating direct create could break Small Office flows.
- **Depends on:** GAP-RECRUITMENT-DETAIL-13, GAP-RECRUITMENT-HOME-05

### GAP-RECRUITMENT-NEW-07  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** loading.tsx heading says "New Vacancy" / "Post a new job opening." while the page says "New Job Opening" / "Post a new vacancy for recruitment." — two names for the same screen; the skeleton is a KPI-grid shape, not a form. apps/web/src/app/(app)/hr/recruitment/new/loading.tsx:8–10
- **Verified evidence:** new/loading.tsx:8-9 uses recruitmentNewJob.loadingHeading 'New Vacancy' and loadingSubtitle 'Post a new job opening.' (en.json:3983-3984), while new/page.tsx:32-33 uses pageTitle 'New Job Opening' and pageSubtitle 'Post a new vacancy for recruitment.'. The skeleton (loading.tsx:13-21) is one 120px block, four 80px tiles and a 240px block - a dashboard shape, not a form. It also lacks the back link the page header renders.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/new/loading.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Use pageTitle/pageSubtitle in loading.tsx and delete loadingHeading/loadingSubtitle keys (all locales).
  2. Render the ds PageHeader with back link as page.tsx does, or the same markup.
  3. Replace the skeleton body with ~8 label+input rows (use ds/Skeleton) inside a Card at max-width 640 to match the form.
- **Acceptance:**
  - Manual: navigating to /hr/recruitment/new shows the same heading in loading and loaded states with no layout jump.
  - Grep: no unused loading* keys remain.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-RECRUITMENT-NEW-08  ·  LOW  ·  partly  ·  theme COPY (was UUID)

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** Placeholders are private-sector examples ("Senior Software Engineer", "JOB-2024-0042") in a Govt/PSU product; Department placeholder for the UUID fallback shows a raw UUID. apps/web/src/messages/en.json (recruitmentNewJob.titlePlaceholder, referenceNoPlaceholder, departmentIdPlaceholder)
- **Verified evidence:** en.json:3988-3992: referenceNoPlaceholder 'e.g. JOB-2024-0042', titlePlaceholder 'e.g. Senior Software Engineer' and departmentIdPlaceholder 'e.g. 3f2504e0-...' (hi.json:4743-4747 carries the same examples). True that they are private-sector style. The UUID input is only rendered when the departments fetch returns nothing (NewJobOpeningForm.tsx:283-295, silent catch at ~85), so it is a fallback, but it is reachable: a failed or empty department load turns the field into a raw-UUID box with no error. Also the dropdown's first option 'Select department…' is a hard-coded English literal (form ~line 279).
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`, `apps/web/src/app/(app)/hr/recruitment/new/NewJobOpeningForm.tsx`
- **Fix steps:**
  1. Replace placeholders with government-style examples (e.g. 'HUD/REC/2026/014', 'Assistant Engineer (Civil)') in en.json and hi.json.
  2. Remove the raw-UUID fallback input; on department load failure show an inline error with a Retry button and keep Submit disabled.
  3. Move 'Select department…' to a message key.
  4. Optionally reuse the shared EntityPicker (DETAIL-06) for departments.
- **Acceptance:**
  - Component test: departments API 500 -> retry button shown, no UUID text field.
  - Grep: no 'Senior Software Engineer' or UUID example in recruitmentNewJob messages.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-RECRUITMENT-DETAIL-06


---
## /hr/recruitment/talent-pool  —  `recruitment/talent-pool.html`

- **Source:** `apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx`
- **Design reference:** `redesign/recruitment/talent-pool.html`

### GAP-RECRUITMENT-TALENT-POOL-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** The page never sends stage or includeActive, so repo.searchApplications applies its default and returns ONLY rejected / withdrawn / not_selected applications. Consequences: the subtitle "All candidates who applied" is false, "Total Candidates" counts only rejected candidates, and "Active Stages" (everything not in that set) is arithmetically always 0. services/hrms-service/src/modules/recruitment/repo.ts:414,424–428; apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx:28–30,74,102
- **Verified evidence:** apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx:28-30 builds ?limit=200[&skill][&minExp] only; routes.ts talent-pool schema (~l.70-84) has stage/includeActive but page never sends them, so services/hrms-service/src/modules/recruitment/repo.ts searchApplications (~l.414-428) applies its default AVAILABLE_STAGES=['rejected','withdrawn','not_selected'] (repo.ts ~l.412). Page l.74 activeStage excludes exactly those stages -> always 0; l.99 Total = only off-pipeline candidates; en.json subtitle 'All candidates who applied' is false. Backend default is deliberate (comment in repo.ts), so the mismatch is page copy/logic.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Decide product intent (see needs=decision): 'available pool' (rejected/withdrawn) vs 'all applicants'.
  2. If all applicants: add a Stage <select> (all/applied/shortlisted/offered/hired/rejected/withdrawn) in the filter form, pass ?stage= or ?includeActive=true from getCandidates(), and keep activeStage stat.
  3. If available pool: keep the API default, remove the 'Active Stages' StatCard (l.102) and activeStage calc (l.74), and reword recruitmentTalentPool.subtitle/statTotalCandidates to 'Available candidates (previously rejected or withdrawn)'.
  4. Extend getCandidates() signature with the new params and encodeURIComponent them; echo them in the empty-state check at l.128.
- **Acceptance:**
  - Component/unit test: with mocked fetch returning mixed stages and includeActive=true, Active Stages stat > 0; with default, card absent or copy states scope.
  - Manual: open /hr/recruitment/talent-pool with a shortlisted applicant in DB -> appears only when Stage=All/Shortlisted is chosen.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Product decision: showing in-pipeline candidates to HR across vacancies was deliberately hidden by a backend MEDIUM finding; reversing needs sign-off.

### GAP-RECRUITMENT-TALENT-POOL-02  ·  HIGH  ·  partly  ·  theme PII

- [x] **Status** — PR #1822 (merged)
- **First-pass claim:** DPDP: full email (and mobile in the payload) of every past applicant tenant-wide is listed and exportable as CSV (exportable=true) for any HR role, with no purpose limitation, masking or retention rule; the backend redacts protected attributes for blind screening elsewhere (screening.ts). apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx:138,154
- **Verified evidence:** Email is a visible column (apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx:138) and DataTable exportable (apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx:154) triggers client-side downloadCsv (apps/web/src/app/_components/ds/DataTable.tsx:~281-292) of all visible columns incl. email, with no server audit and no masking. Mobile is in the API payload (routes.ts ~l.95-100) and the Candidate type (l.17) but is NOT rendered or exported. Overstated: route is gated by HR_ROLES=[hr_admin,hr_officer,super_admin] (routes.ts:18, requireRole in talent-pool handler) and page renders PermissionDenied for 403, so not 'any HR role' beyond those three. No shared <Masked> component exists in the repo (only a local MaskedInput in hr/employees/new/steps/Step4.tsx). Backend redactApplicant (screening.ts:78) is not applied to this endpoint.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`, `services/hrms-service/src/modules/recruitment/routes.ts`
- **Fix steps:**
  1. Create ds/Masked.tsx (mask e.g. a***@d***.com, click-to-reveal for allowed roles) and use it via a column render for 'email' in talent-pool.
  2. Drop 'mobile' from the talent-pool response in routes.ts (page does not use it) or gate it behind a reveal call.
  3. Remove exportable from this DataTable, or add an onExport hook to DataTable that POSTs an audit event (via existing audit path) before download, and export masked values by default.
  4. Add a purpose/retention note (DPDP) under the filter card once policy text is agreed.
- **Acceptance:**
  - Component test: email cell renders masked; reveal shows full value only for hr_admin.
  - Test: CSV export from this page contains masked emails (or button absent).
  - Integration test: GET /v1/hrms/talent-pool response has no mobile field.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII/DPDP: incorrect masking could hide contact data HR legitimately needs; audit event contract must be added to @civitasone/events.

### GAP-RECRUITMENT-TALENT-POOL-03  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** Rows are dead ends: no link to the application, the vacancy or a candidate profile, and jobOpeningId returned by the API is not in the page’s Candidate type. apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx:14–25,135–155; services/hrms-service/src/modules/recruitment/routes.ts:101
- **Verified evidence:** DataTable at apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx:135-155 has no render/link column; Candidate type (apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx:14-25) omits jobOpeningId although routes.ts returns it (talent-pool map ~l.99-102). Routes that could be targeted exist: /hr/recruitment/[id] and /hr/recruitment/[id]/applications/[appId]/page.tsx.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx`
- **Fix steps:**
  1. Add jobOpeningId: string to Candidate type.
  2. Add a 'render' to the applicantName column returning <Link href={`/hr/recruitment/${c.jobOpeningId}/applications/${c.id}`}>.
  3. Add an optional 'Vacancy' column linking to /hr/recruitment/${jobOpeningId}.
  4. Guard for null jobOpeningId by rendering plain text.
- **Acceptance:**
  - Component test: name cell is an anchor with the expected href.
  - Manual: click a candidate -> application detail page loads.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; verify the application page tolerates access from the talent pool (HR roles only).

### GAP-RECRUITMENT-TALENT-POOL-04  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** Source and Stage go through StatusPill with an unknown-status fallback of "info" — "public_portal" renders as a blue "Public Portal" pill and "withdrawn" as blue too; only rejected maps to a semantic colour. apps/web/src/app/_components/ds/StatusPill.tsx:5–41; apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx:142–143
- **Verified evidence:** apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx:142-143 use cellType 'status' -> DataTable.tsx:127 StatusPill; apps/web/src/app/_components/ds/StatusPill.tsx STATUS_MAP has only 'rejected' (bad) among these; unknown keys fall to 'info' (l.~52). 'withdrawn','not_selected','public_portal','internal','applied','shortlisted','offered','hired' all render blue. humanizeStatus makes 'Public Portal'.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx`
- **Fix steps:**
  1. Add to STATUS_MAP: withdrawn->mut, not_selected->mut, hired->good, offered->warn, shortlisted->info, applied->info.
  2. Render Source as plain text (or neutral pill) instead of cellType 'status' in the source column (l.142) since source is not a status.
  3. Add StatusPill unit tests for new keys.
- **Acceptance:**
  - StatusPill test: 'withdrawn' -> class 'pill mut', 'hired' -> 'pill good'.
  - Manual: Source column no longer coloured.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** StatusPill is shared; new keys may recolour other screens using those words.

### GAP-RECRUITMENT-TALENT-POOL-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** The source filter the API supports (?source=) has no input, and the skill filter is a substring match done in JS after an over-fetch of limit×2 rows (repo.ts:430–441) — results are capped at 200 regardless of how many candidates match. apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx:27–30
- **Verified evidence:** apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx:27-30 sends only limit,skill,minExp; routes.ts accepts source but page has no input. services/hrms-service/src/modules/recruitment/repo.ts searchApplications does SQL .limit(limit*2) (=400 at limit 200) BEFORE JS skill/minExp filters then slice(0,limit): matches outside the newest 400 rows are silently missed, so filtering is incorrect at scale, not just capped. No pagination in page beyond client-side DataTable pageSize 20.
- **Files to change:** `services/hrms-service/src/modules/recruitment/repo.ts`, `apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx`, `services/hrms-service/src/modules/recruitment/routes.ts`
- **Fix steps:**
  1. Move minExp into SQL (gte on experienceYears) and skill into SQL using array containment/ILIKE over unnest, in searchApplications.
  2. Add offset/limit + total count to the route response and Prev/Next in the page.
  3. Add a Source <select> (internal/public_portal) to the filter form and forward ?source=.
  4. Remove the limit*2 over-fetch.
- **Acceptance:**
  - Repo integration test: 500 rows, only oldest matches skill -> returned.
  - Route test: response carries total; page shows 'x of total'.
  - Manual: Source filter narrows results.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Read path must keep Redis read-through and p95 <200ms; add GIN index migration for skills.

### GAP-RECRUITMENT-TALENT-POOL-06  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** Experience renders as "0 yr" for freshers and "7 yr" (no plural) via expYearShort, while the vacancy page says "7 yrs exp" — inconsistent. apps/web/src/messages/en.json (recruitmentTalentPool.expYearShort); apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx:84
- **Verified evidence:** apps/web/src/messages/en.json:4059 expYearShort='{years} yr'; used at talent-pool page.tsx:84 -> '0 yr', '7 yr'. Vacancy page uses ICU plural yearsExpSuffix (en.json:3889, hr/recruitment/[id]/page.tsx:1001) -> '7 yrs exp'.
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx`
- **Fix steps:**
  1. Change key to '{years, plural, one {# yr} other {# yrs}}' (same as en.json:3844 experienceYears).
  2. Pass years as number (already) and keep l.84 call; update other locale files if present.
  3. Optionally render 'Fresher' for 0.
- **Acceptance:**
  - i18n test: 1 -> '1 yr', 0 -> '0 yrs', 7 -> '7 yrs'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-RECRUITMENT-TALENT-POOL-07  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1818 (merged)
- **First-pass claim:** The Search button uses the DS Button with an inline minHeight override and the Clear action is a link styled as a button — the two controls are different elements with the same look. apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx:116–117
- **Verified evidence:** apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx:116-117: Button variant='primary' vs Link className='btn ghost' -- they intentionally differ (primary vs ghost), so 'same look' is wrong. True part: both carry inline minHeight:44 and the Clear control is an anchor rather than Button; inline style duplicated.
- **Files to change:** `apps/web/src/app/(app)/hr/recruitment/talent-pool/page.tsx`
- **Fix steps:**
  1. Move minHeight 44 into the DS Button/btn class so no inline style is needed.
  2. If Button supports href/asChild, use it for Clear; otherwise leave the Link.
- **Acceptance:**
  - Visual check: primary and ghost differ; no inline minHeight in markup.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## Backend verification items (service code absent from snapshot)

### GAP-RECRUITMENT-DETAIL-03  ·  HIGH  ·  partly  ·  theme BACKEND

- [x] **Status** — PR #1822 (merged)
- **First-pass claim:** Checklist gap — reservation roster (Government profile, "reservation roster" highest-risk area; R-RA-0082 in reference-domain.ts): the card shows GFR-2017 quota percentages computed client-side from GOI_RESERVATION_QUOTA_PCT, not the vacancy's sanctioned roster. EWS (10%) and horizontal PwBD/ex-servicemen/women reservations are absent; "PH" is used instead of PwBD. The real roster API (PUT /v1/hrms/job-openings/:id/reservation-roster, approve with SoD, reservation-shortlist) has no UI. apps/web/src/app/(app)/hr/recruitment/_components/GOIReservationCard.tsx:13–15,42–47; services/hrms-service/src/modules/recruitment/reservation-routes.ts:35–87
- **Service:** `hrms-service`  ·  **Endpoint(s):** `['PUT/GET /v1/hrms/job-openings/:id/reservation-roster', 'POST .../reservation-roster/approve', 'POST .../reservation-shortlist']`
- **Question:** Does the service already provide the sanctioned roster with role gate and SoD?
- **How to verify:** Read reservation-routes.ts and reservation-domain.ts.
- **Test to add:** Given roster created by U, when U approves, then 403 SOD_VIOLATION; assert EWS accepted and PwBD rejected until added.
- **Impact if wrong:** Recruitment shortlists on incorrect reservation quotas; legal challenge.
- **Web change if wrong:** Replace GOIReservationCard client-side percentages with the roster GET and add set/approve/shortlist UI.
- **Finding:** reservation-routes.ts:33-50 PUT with HR_ROLES and validateRoster; :71-79 approve requires hr_admin/super_admin and 403 SOD_VIOLATION when createdBy==actor; reservation-domain.ts:13 categories UR/SC/ST/OBC/EWS (EWS supported, no horizontal PwBD/ex-servicemen/women). Web: GOIReservationCard.tsx:42-47 uses client constants with 'PH'; grep finds no web call to reservation-roster.
