# Detailed gap file — module `docs`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 14, REFUTED 1



---
## /docs  —  `docs/home.html`

- **Source:** `apps/web/src/app/(marketing)/docs/page.tsx`
- **Design reference:** `redesign/docs/home.html`

### GAP-DOCS-HOME-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Manual chapters stop at the original module set; Court Mgmt, Service Designer, Visitor, Meeting and Inspection routes exist in the app but have no chapter (docs/_content/chapters.ts slugs vs app routes).
- **Verified evidence:** apps/web/src/app/(marketing)/docs/_content/chapters.ts slugs: getting-started, finance, hr-payroll, procurement, projects-grants, establishment, citizen-helpdesk, stock-assets, small-business, admin-settings, mobile-app, glossary. Sidebar.tsx:97-101 has Service Designer, Visitor, Meeting, Court, Inspection with no chapter.
- **Files to change:** `apps/web/src/app/(marketing)/docs/_content/chapters.ts`
- **Fix steps:**
  1. Add chapters: service-designer, visitor, meeting, court, inspection (and documents if wanted) to chapters array
  2. Insert before glossary; content owners to write text
- **Acceptance:**
  - /docs lists new cards
  - Each new slug renders via generateStaticParams
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Content authoring effort; PDF must be regenerated.

### GAP-DOCS-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme SEARCH (was WIRING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No search or on-page filter across 12 long chapters; the Glossary is a separate chapter instead of inline term help (docs/page.tsx).
- **Verified evidence:** apps/web/src/app/(marketing)/docs/page.tsx is a static grid of chapters; no search/filter. Glossary is chapter slug 'glossary'. Theme WIRING is wrong.
- **Files to change:** `apps/web/src/app/(marketing)/docs/page.tsx`, `apps/web/src/app/(marketing)/docs/[slug]/page.tsx`
- **Fix steps:**
  1. Add client-side filter over chapter title/description on /docs
  2. Optionally a build-time search index over chapters content
  3. Link glossary terms inline (later)
- **Acceptance:**
  - Typing 'leave' shows HR chapter
  - Empty query shows all
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-DOCS-HOME-03  ·  MEDIUM  ·  partly  ·  theme NAV (was STATUS)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Chapter cards use emoji icons and a numbering derived from array index, so reordering renumbers external references (docs/page.tsx i + 1).
- **Verified evidence:** apps/web/src/app/(marketing)/docs/page.tsx:~37 renders '{i + 1}. {chapter.title}' and apps/web/src/app/(marketing)/docs/[slug]/page.tsx sidebar uses same; emoji icons from chapter.icon. URLs use stable slugs, so external links do not renumber; only visible numbers change on reorder. Theme STATUS wrong.
- **Files to change:** `apps/web/src/app/(marketing)/docs/page.tsx`, `apps/web/src/app/(marketing)/docs/_content/chapters.ts`
- **Fix steps:**
  1. Add optional explicit 'number' field to chapters if numbers are cited externally
  2. Else drop numbering
- **Acceptance:**
  - Reordering does not change cited numbers
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DOCS-HOME-04  ·  LOW  ·  partly  ·  theme DEADROUTE (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** PDF download target is a static file whose generation is not in the web app; it can drift from chapters.ts (page.tsx href).
- **Verified evidence:** apps/web/src/app/(marketing)/docs/page.tsx:~20 href '/docs/CivitasOne-User-Manual.pdf'. apps/web has no public/ directory in this snapshot and no such PDF or openapi.yaml exists in the repo, so the link is likely a 404 or served by deploy tooling not visible here.
- **Files to change:** `apps/web/src/app/(marketing)/docs/page.tsx`, `apps/web/src/app/(marketing)/docs/[slug]/page.tsx`
- **Fix steps:**
  1. Confirm where the PDF is hosted; add to apps/web/public/docs or a route handler
  2. Generate PDF from chapters.ts in CI to prevent drift
- **Acceptance:**
  - Link returns 200 application/pdf
  - CI fails if chapters newer than PDF
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.


---
## /docs/[slug]  —  `docs/slug.html`

- **Source:** `apps/web/src/app/(marketing)/docs/[slug]/page.tsx`
- **Design reference:** `redesign/docs/slug.html`

### GAP-DOCS-SLUG-01  ·  MEDIUM  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Sidebar is hidden below lg and replaced by a single '← All Chapters' link, so on mobile there is no chapter navigation except prev/next (page.tsx:46 'hidden lg:block').
- **Verified evidence:** apps/web/src/app/(marketing)/docs/[slug]/page.tsx:46 <aside className='hidden lg:block'>; below lg a '← All Chapters' link (lg:hidden) goes to /docs, whose grid lists all chapters, plus prev/next. So mobile navigation exists but costs a full page hop.
- **Files to change:** `apps/web/src/app/(marketing)/docs/[slug]/page.tsx`
- **Fix steps:**
  1. Add a <details>/select 'Chapters' dropdown for <lg using chapters array
- **Acceptance:**
  - At 375px width user can jump to any chapter in one tap
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DOCS-SLUG-02  ·  MEDIUM  ·  partly  ·  theme COPY (was MONEY)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Instructions are written for touch ('Tap Save') although the doc set serves desktop office staff, and money examples are 'amount in rupees' without lakh-grouping examples (chapters.ts:117-125).
- **Verified evidence:** apps/web/src/app/(marketing)/docs/_content/chapters.ts:31-36,118-145 use 'Tap' and 'Enter the Budget Estimate amount in rupees' (:121). Confirmed wording; no lakh grouping example. This is prose only, no code money handling, so paise theme is not applicable.
- **Files to change:** `apps/web/src/app/(marketing)/docs/_content/chapters.ts`
- **Fix steps:**
  1. Replace 'Tap' with 'Click/Select' for desktop chapters (keep for mobile-app chapter)
  2. Add example '12,50,000' Indian grouping and state units
- **Acceptance:**
  - grep 'Tap ' only in mobile-app chapter
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-DOCS-SLUG-03  ·  MEDIUM  ·  confirmed  ·  theme NAV (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No in-page table of contents or heading anchors for long chapters (Glossary lists A-U terms as H2s); the renderer emits headings without ids (markdown.tsx:59-69).
- **Verified evidence:** apps/web/src/app/(marketing)/docs/_content/markdown.tsx:59-75 h1/h2/h3 rendered without id attributes; apps/web/src/app/(marketing)/docs/[slug]/page.tsx has no ToC. Theme I18N wrong.
- **Files to change:** `apps/web/src/app/(marketing)/docs/_content/markdown.tsx`, `apps/web/src/app/(marketing)/docs/[slug]/page.tsx`
- **Fix steps:**
  1. Slugify heading text into id in markdown.tsx headings
  2. Build ToC from ## and ### and render in right rail (lg) / collapsible (mobile)
  3. Add anchor links
- **Acceptance:**
  - #heading URL scrolls to section
  - ToC lists all h2s
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-DOCS-SLUG-04  ·  LOW  ·  partly  ·  theme DEADROUTE

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Unknown slugs fall to the framework 404, not a designed docs not-found (page.tsx notFound()).
- **Verified evidence:** apps/web/src/app/(marketing)/docs/[slug]/page.tsx calls notFound(); apps/web/src/app/not-found.tsx exists as a custom app EmptyState '404 — Page not found', so it is not the raw framework 404, only not docs-specific.
- **Files to change:** `apps/web/src/app/(marketing)/docs/not-found.tsx`
- **Fix steps:**
  1. Add docs/not-found.tsx with link to /docs and chapter list
- **Acceptance:**
  - /docs/xyz shows docs-specific message with chapter links
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DOCS-SLUG-05  ·  LOW  ·  partly  ·  theme COPY (was WIRING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The metadata title suffix '— CivitasOne Docs' differs from the product suffix used elsewhere.
- **Verified evidence:** apps/web/src/app/(marketing)/docs/[slug]/page.tsx:19 title '{title} — CivitasOne Docs' vs other marketing pages '— CivitasOne'. Minor difference, arguably intentional section naming.
- **Files to change:** `apps/web/src/app/(marketing)/docs/[slug]/page.tsx`
- **Fix steps:**
  1. Use metadata title template in docs layout or align suffix
- **Acceptance:**
  - Titles consistent
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /docs/api  —  `docs/api.html`

- **Source:** `apps/web/src/app/(marketing)/docs/api/page.tsx`
- **Design reference:** `redesign/docs/api.html`

### GAP-DOCS-API-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Numbers disagree: hero text says 33 microservices / 1,185+ endpoints, the grid lists 10 services totalling 279 endpoints, and the curated spec has 35 — all hard-coded, none generated (docs/api/page.tsx services array vs intro).
- **Verified evidence:** apps/web/src/app/(marketing)/docs/api/page.tsx:6-7 and hero: '33 microservices' and '1,185+ endpoints' (also :~95 '1,185'); services array (:10-21) has 10 entries summing 279; :~91 'top 35 most-used'. All hard-coded strings.
- **Files to change:** `apps/web/src/app/(marketing)/docs/api/page.tsx`
- **Fix steps:**
  1. Compute total from services array or state 'sample of 10 services'
  2. Remove 33/1,185 or source from generated spec count at build time (scripts/docs/generate-openapi.mjs referenced, not verified)
  3. Keep metadata description in sync
- **Acceptance:**
  - Displayed totals equal array sum or labelled 'selected'
  - No unsourced counts
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Marketing accuracy only.

### GAP-DOCS-API-02  ·  HIGH  ·  partly  ·  theme COPY (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The example advertises the client_credentials flow with client_secret in a form-encoded body against a public docs page and 'Production Base URL'; no note on secret handling or scopes and it conflicts with the Developer Portal, which says API Reference is 'Planned' (page.tsx auth block; developer-portal/page.tsx).
- **Verified evidence:** apps/web/src/app/(marketing)/docs/api/page.tsx:~57-64 pre block shows client_credentials with placeholders <id>/<secret>: no real secret, so not a PII/secrets leak; standard OAuth docs. Valid points: no guidance on secret storage, scopes, or tenant base URL, and the Developer Portal marks API Reference 'Planned' (developer-portal/page.tsx:35).
- **Files to change:** `apps/web/src/app/(marketing)/docs/api/page.tsx`
- **Fix steps:**
  1. Add a note: keep client_secret server-side, rotate via API Keys, list scopes
  2. Align status with developer portal (see HOME-02)
- **Acceptance:**
  - Auth block has secret-handling note
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-DEVELOPER-PORTAL-HOME-02

### GAP-DOCS-API-03  ·  MEDIUM  ·  partly  ·  theme COPY (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'Production Base URL' is an external link to api.civitasone.app labelled generically; government tenants self-host, so a fixed production URL is misleading (page.tsx:~46).
- **Verified evidence:** apps/web/src/app/(marketing)/docs/api/page.tsx:~40 href 'https://api.civitasone.app' labelled 'Production Base URL'. Hard-coded; no config. Self-hosting claim is not verifiable from code but Editions/on-prem is in CLAUDE.md.
- **Files to change:** `apps/web/src/app/(marketing)/docs/api/page.tsx`
- **Fix steps:**
  1. Read base URL from env (NEXT_PUBLIC_API_DOCS_BASE) or label 'Hosted (SaaS) base URL'
  2. Add text that self-hosted tenants use their own host
- **Acceptance:**
  - Label shows correct scope
  - Env override changes link
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DOCS-API-04  ·  MEDIUM  ·  partly  ·  theme UX (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Code samples are dark green-on-black <pre> blocks with fixed colours (text-green-400 on gray-900) that ignore theme tokens; no copy button (page.tsx pre blocks).
- **Verified evidence:** apps/web/src/app/(marketing)/docs/api/page.tsx pre blocks use 'bg-gray-900 text-green-400' (two blocks). Green-400 on gray-900 has good contrast; whole marketing group uses fixed tailwind grays, not theme tokens. No copy button: confirmed. Not an i18n issue.
- **Files to change:** `apps/web/src/app/(marketing)/docs/api/page.tsx`, `apps/web/src/app/(marketing)/docs/_content/markdown.tsx`
- **Fix steps:**
  1. Create small client <CopyCodeBlock> and use in both pre blocks and markdown code renderer
  2. Add aria-label on the button and toast/aria-live confirm
- **Acceptance:**
  - Clicking copy puts the exact text on clipboard
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-DOCS-API-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'Keycloak OIDC' and 'SQS' are implementation details exposed to API consumers as contract.
- **Verified evidence:** apps/web/src/app/(marketing)/docs/api/page.tsx hero text 'Keycloak OIDC' and CQRS note 'processed asynchronously via SQS'. CLAUDE.md says queue is an adapter over SQS/Kafka/RabbitMQ, so SQS is deployment-specific and wrong on-prem.
- **Files to change:** `apps/web/src/app/(marketing)/docs/api/page.tsx`
- **Fix steps:**
  1. Replace 'via SQS' with 'via the message queue'
  2. Keep Keycloak only in token URL path, say 'OIDC-compliant IdP'
- **Acceptance:**
  - No SQS text on page
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## Refuted by deep pass — do NOT implement

### GAP-DOCS-HOME-05 · /docs
- **First-pass claim:** Metadata title uses the em-dash 'Documentation — CivitasOne'; the suite title convention elsewhere is '· CivitasOne Suite'.
- **Why refuted:** apps/web/src/app/(marketing)/docs/page.tsx:6 title 'Documentation — CivitasOne' matches every marketing page (pricing, contact, sandbox use '— CivitasOne'). No '· CivitasOne Suite' convention found in apps/web/src (grep empty); root layout title is just 'CivitasOne Suite'.
