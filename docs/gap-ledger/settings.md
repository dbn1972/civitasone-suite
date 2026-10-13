# Detailed gap file — module `settings`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 6, BACKEND-VERIFY 1



---
## /settings/branding  —  `settings/branding.html`

- **Source:** `apps/web/src/app/(app)/settings/branding/page.tsx`
- **Design reference:** `redesign/settings/branding.html`

### GAP-SETTINGS-BRANDING-01  ·  HIGH  ·  confirmed  ·  theme CONTRAST (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Primary foreground is never recomputed: updateColor("colorPrimary") only sets the one key, colorPrimaryFg stays "#ffffff", and readableForeground is applied to the accent button alone — choose a light primary and the header, active nav item and Primary Action render white on light, and the unreadable pair is what gets PUT (page.tsx:24,190,217,270,295,331,412-416).
- **Verified evidence:** apps/web/src/app/(app)/settings/branding/page.tsx:412-416 updateColor only sets the given key; :331 colorPrimaryFg defaults '#ffffff'; applyPreset (:418-428) changes colorPrimary/Secondary/Accent without touching colorPrimaryFg. readableForeground (:24) is only called for the accent button at :295. colorPrimaryFg is used at :190, :217, :270 and the whole config is PUT at handleSave (body JSON.stringify(config)). So a light primary gives white-on-light and that pair is persisted.
- **Files to change:** `apps/web/src/app/(app)/settings/branding/page.tsx`
- **Fix steps:**
  1. In updateColor and applyPreset, when key/colour is colorPrimary also set colorPrimaryFg = readableForeground(value).
  2. Also apply after the initial fetch resolves (.then(setConfig)) in case the stored fg is stale.
  3. Move readableForeground to a shared lib (apps/web/src/lib/contrast.ts) and add unit tests.
  4. Optionally expose a contrast warning next to the Primary picker.
- **Acceptance:**
  - Unit test: choosing #fde68a as primary yields colorPrimaryFg '#111827' in the PUT body.
  - Preview header text, active nav item and Primary Action meet 4.5:1.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Changes what is persisted for every tenant on next save; existing saved pairs stay until edited.
- **Depends on:** GAP-SETTINGS-BRANDING-06

### GAP-SETTINGS-BRANDING-02  ·  HIGH  ·  confirmed  ·  theme RESPONSIVE (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Editor is not responsive: root is `flex h-screen` with a fixed `w-[420px]` column and an `overflow-y-auto` panel, no breakpoints, so on a phone or narrow window the preview is pushed off-screen and the page is fixed to 100vh inside AppShell (page.tsx:463-466).
- **Verified evidence:** apps/web/src/app/(app)/settings/branding/page.tsx:464 root is `flex h-screen` and :466 the editor is `w-[420px] border-e overflow-y-auto`, with the preview `flex-1` (:~640). No sm:/md: breakpoints anywhere in the file, so below ~700px the preview is squeezed to nothing. Note AppShell also adds its own chrome, so h-screen overflows the viewport. Theme PII is wrong; this is a responsive-layout issue.
- **Files to change:** `apps/web/src/app/(app)/settings/branding/page.tsx`
- **Fix steps:**
  1. Change the root to `flex flex-col lg:flex-row min-h-[calc(100dvh-var(--header-h))]` (or min-h-0 without h-screen).
  2. Make the editor `w-full lg:w-[420px] lg:overflow-y-auto` and the preview stack below it on small screens.
  3. Consider a Edit/Preview toggle (Tabs) for mobile.
  4. Make the sticky Save button remain visible.
- **Acceptance:**
  - At 375px width the editor and preview are both reachable and there is no horizontal scroll.
  - At 1280px layout unchanged.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-SETTINGS-BRANDING-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0-10 note:** review found the W0 tick partly — Client dropzone+file input, PNG/SVG, 200KB and https/data: URL validation done (branding/page.tsx:465-512,694-738), but upload is only a data: URL put in logoUrl and sent in PUT while theme-service upsertBrandBody validates logoUrl as z.string().url().max(2048) (services/theme-service/src/modules/tokens/validators.ts:28), so a 150KB data URL cannot persist; no upload endpoint/SVG sanitisation (code comment 'backend sanitises' is not true). Acceptance 'persists after save' fails
- **First-pass claim:** "Drag & drop logo here" has no drop handler and no file input — the only working control is the "Logo image URL" text box, and the arbitrary URL is rendered in <img> in the preview and sent unchecked to the API (page.tsx:503-530).
- **Verified evidence:** apps/web/src/app/(app)/settings/branding/page.tsx:503-530 the dashed zone shows 'Drag & drop logo here' (:515) and 'SVG or PNG, max 200KB' but has no onDrop/onDragOver/onClick handlers and no <input type=file>; the only control is a text input `Logo image URL` writing config.logoUrl, rendered via <img src> in the zone (:511) and in the preview (:~182), and sent in the PUT. No validation of scheme or type. Also, middleware CSP is `img-src 'self' data: blob:` (middleware.ts:73), so an external https logo URL will be blocked in the browser anyway; only same-origin or data: URLs render. There is a FileUpload DS component (_components/ds/FileUpload.tsx) that could be reused, but its backend upload endpoint is not visible.
- **Files to change:** `apps/web/src/app/(app)/settings/branding/page.tsx`, `apps/web/src/app/_components/ds/FileUpload.tsx`, `(backend) theme-service logo upload endpoint if absent`
- **Fix steps:**
  1. Confirm whether theme-service has a logo upload endpoint; if not, add one (S3 adapter, 200KB, SVG/PNG, SVG sanitised).
  2. Replace the dashed div with the DS FileUpload (accept image/svg+xml,image/png, max 200KB), upload via /api/proxy, and store the returned URL in logoUrl.
  3. Keep the URL text box only as an advanced option, validated with zod/URL (https only) and matching CSP, or remove it.
  4. Update text to match what is enforced.
- **Acceptance:**
  - Dropping a 150KB PNG uploads, previews, and persists after save.
  - A 300KB file or a .exe is rejected with a clear message.
  - An http:// or javascript: URL is rejected.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium. Uploaded SVG can carry script; sanitise or restrict to PNG. Arbitrary external URLs leak viewer IPs and clash with CSP.

### GAP-SETTINGS-BRANDING-05  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1925 — Added tagline, footer, poweredBy controls; dark logo, favicon, login bg, fonts, sidebar/header style still no controls
- **First-pass claim:** Only colours, app name, logo URL and roundness are editable; tagline, dark logo, favicon, login background, footer text, poweredBy, fonts, sidebar/header style exist in BrandConfig and defaults but have no controls, and the file header still promises a "font selector" (page.tsx:1-10,322-345).
- **Verified evidence:** apps/web/src/app/(app)/settings/branding/page.tsx:10 header comment still mentions 'font selector'. BrandConfig (:51-~80) and the defaults (:321-348) include tagline, logoDarkUrl, faviconUrl, loginBgUrl, footerText, poweredBy, fontFamily, fontFamilyMono, sidebarStyle, headerStyle, customCss; the editor renders controls only for appName, logoUrl, presets, nine colours (Primary/Secondary/Accent/Background/Surface/Text/Success/Warning/Error, no Border/Muted/PrimaryFg) and roundness. The full config is PUT, so unedited fields are round-tripped as loaded.
- **Files to change:** `apps/web/src/app/(app)/settings/branding/page.tsx`
- **Fix steps:**
  1. Decide which fields are in scope for tenants (tagline, footer text, poweredBy, favicon, login background, fonts).
  2. Add controls for the chosen ones (text inputs and a font Select from an allow-list) and show them in LivePreview.
  3. Remove the 'font selector' claim from the header comment and any unused fields from the editor state if out of scope.
  4. Do not let customCss be editable without review (XSS/CSS injection).
- **Acceptance:**
  - Editing the footer text changes the preview and persists after reload.
  - Header comment matches implemented controls.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low to medium. customCss and remote URLs need sanitising.

### GAP-SETTINGS-BRANDING-06  ·  MEDIUM  ·  confirmed  ·  theme CONTRAST (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Text-on-Background and Text-on-Surface contrast is never checked, so a tenant can save an inaccessible palette; only the accent button gets a derived foreground (page.tsx:295).
- **Verified evidence:** apps/web/src/app/(app)/settings/branding/page.tsx only calls readableForeground for the accent button (:295). There is no contrast check between colorText and colorBackground/colorSurface (preview uses them at :~209,:217), nor for links/borders, and handleSave (:~440) sends whatever is chosen. Theme I18N is wrong (accessibility).
- **Files to change:** `apps/web/src/app/(app)/settings/branding/page.tsx`, `apps/web/src/lib/contrast.ts (new)`
- **Fix steps:**
  1. Create contrastRatio(fg,bg) in lib/contrast.ts (reuse the luminance code from readableForeground).
  2. Compute ratios for Text/Background, Text/Surface, Primary/PrimaryFg, Muted/Background and show an inline warning under the pickers below 4.5:1.
  3. Disable Save (or require an explicit acknowledge) while a critical pair fails; enforce the same rule in theme-service.
- **Acceptance:**
  - Unit test: contrastRatio('#000000','#ffffff') = 21; ('#777777','#ffffff') < 4.5.
  - Setting Text to #cccccc on white shows a warning and blocks Save.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low. Blocking Save may annoy tenants with brand mandated colours, so consider warn-only first.
- **Depends on:** GAP-SETTINGS-BRANDING-01

### GAP-SETTINGS-BRANDING-07  ·  LOW  ·  confirmed  ·  theme LOADING (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0-10 note:** review found the W0 tick partly — loading skeleton added (page.tsx:560) but on brand-fetch failure Save stays enabled and message says Showing defaults — review before saving (page.tsx:411-415), no Retry button; canEdit (page.tsx:366) ignores loadError so defaults can overwrite stored branding
- **First-pass claim:** On first load the editor shows hard-coded defaults with no skeleton or "loading" state until the brand fetch resolves, so a returning admin may edit and save over their real branding before it loads (page.tsx:383-409).
- **Verified evidence:** apps/web/src/app/(app)/settings/branding/page.tsx:321-348 initial state is hard-coded defaults; the load effect at :373-393 replaces it via .then(setConfig) with no loading flag. Save is disabled only by `!dirty || saving` (:~640), so an admin can edit within the fetch window, and then setConfig overwrites their edit, or if they save first, the PUT (whole config) writes defaults over stored branding. On load failure the banner says 'Showing defaults — saving will still work' (:~396), which invites overwriting real branding with defaults.
- **Files to change:** `apps/web/src/app/(app)/settings/branding/page.tsx`
- **Fix steps:**
  1. Add a `loading` state (true until the brand fetch settles); show a skeleton (DS Skeleton) and disable inputs and Save while loading.
  2. On brand-fetch failure keep Save disabled and offer Retry rather than saving defaults.
  3. Track the loaded config version/updatedAt and send it for optimistic concurrency if the API supports it.
- **Acceptance:**
  - Throttled network: the form shows a skeleton and Save is not clickable until data arrives.
  - With the brand endpoint returning 500 Save stays disabled and a retry button is shown.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Medium. Currently can silently reset a tenant's branding to defaults.


---
## Backend verification items (service code absent from snapshot)

### GAP-SETTINGS-BRANDING-03  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1925 — Client role check (BRANDING_ADMIN_ROLES) and save confirm added; no settings layout gate; server auth/audit unverifiable
- **First-pass claim:** Any signed-in user can rewrite tenant-wide branding: no requireAnyRole, no settings/layout.tsx and no ModuleGate; Save PUTs the entire BrandConfig with no confirmation and no audit indication in the UI. theme-service is absent from the snapshot (services/ has only hrms-service), so server role checks and auditing are undeterminable (page.tsx:430-455).
- **Service:** `theme-service`  ·  **Endpoint(s):** `['GET/PUT /api/proxy/v1/themes/brand', 'GET /api/proxy/v1/themes/brand/presets']`
- **Question:** Does PUT /v1/themes/brand require a tenant-admin role and emit an audit event with before/after?
- **How to verify:** Open theme-service brand route: role guard and audit emit. PUT as a non-admin token expecting 403.
- **Test to add:** Given non-admin user; when PUT brand config; then 403 and no change; given admin then 200 and audit event brand.updated with diff.
- **Impact if wrong:** Any user can deface tenant branding (phishing/reputation).
- **Web change if wrong:** Add requireAnyRole(tenant admin) and confirmation dialog on Save in settings/branding/page.tsx:430-455 and a settings layout gate.
