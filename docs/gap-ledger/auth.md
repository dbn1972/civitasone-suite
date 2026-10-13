# Detailed gap file — module `auth`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 15, BACKEND-VERIFY 3



---
## /auth/dev  —  `auth/dev.html`

- **Source:** `apps/web/src/app/auth/dev/page.tsx`
- **Design reference:** `redesign/auth/dev.html`

### GAP-AUTH-DEV-01  ·  HIGH  ·  confirmed  ·  theme SECRETS (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The page prints DEV_LOGIN_PASSWORD in clear text next to the account names (page.tsx:83) to any visitor when the flag is on — a shared credential for accounts that include superadmin and auditor. The only protection is the env flag; a mis-set flag in staging exposes full access.
- **Verified evidence:** page.tsx:92 (not 83) renders process.env.DEV_LOGIN_PASSWORD in a <code> to any visitor when isDevLoginEnabled() (ENABLE_DEV_LOGIN==='true', lib/auth/env.ts:6). Listed accounts include superadmin and auditor; all share one password (route.ts:31-111). Related: if DEV_LOGIN_PASSWORD is unset, DEV_PASSWORD is '' (route.ts:13) so a direct POST with empty password matches every persona (route.ts:154), and JWT_SECRET falls back to a public literal (route.ts:8). Gate is only the env flag plus a NODE_ENV-independent check.
- **Files to change:** `apps/web/src/app/auth/dev/page.tsx`, `apps/web/src/app/api/auth/dev-login/route.ts`, `apps/web/src/lib/auth/env.ts`
- **Fix steps:**
  1. Remove the password from the rendered page; document it in the .env / README instead.
  2. In route.ts reject login when DEV_PASSWORD is empty and refuse to start (throw) if ENABLE_DEV_LOGIN is true with NODE_ENV==='production'.
  3. Require JWT_SECRET explicitly when dev login is on (no default literal).
  4. Add a unit test for the empty-password case.
- **Acceptance:**
  - Test: with DEV_LOGIN_PASSWORD unset, POST dev-login returns 303 to ?error=1.
  - Manual: /auth/dev HTML contains no password string.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Credential exposure across superadmin/auditor personas if flag mis-set.

### GAP-AUTH-DEV-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The POST handler (api/auth/dev-login/route.ts, 166 lines) contains no rate-limit, lockout or CSRF/origin check (grep finds none); failures 303 to /auth/dev?error=1 (:155). The next path is guarded against open redirect (:159-160). With the account list on the page, brute force is only limited by whatever sits in front of it.
- **Verified evidence:** dev-login/route.ts (166 lines) has no rate limit, lockout, or Origin/CSRF check; grep of middleware.ts and the route for rate/origin/csrf finds only the Keycloak connect-src. Failure redirects 303 to /auth/dev?error=1 (line 155); next open-redirect guard at 159-160 is present. /api/auth is in PUBLIC (middleware.ts:11). cookie is sameSite lax, so cross-site form POST login is possible (login CSRF). Any gateway-level throttling is cannot-verify.
- **Files to change:** `apps/web/src/app/api/auth/dev-login/route.ts`
- **Fix steps:**
  1. Verify Origin/Referer host equals publicBase(req) host before processing; return 403 otherwise.
  2. Add a per-IP + per-username in-memory (or Redis) failure counter with lockout and 429; add a small constant delay on failure.
  3. Log failed attempts via the audit logger (no console.log).
- **Acceptance:**
  - Test: 6 bad attempts in a minute -> 429.
  - Test: POST with foreign Origin -> 403.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Dev-only route; low product risk, medium security value.
- **Depends on:** GAP-AUTH-DEV-01

### GAP-AUTH-DEV-03  ·  MEDIUM  ·  partly  ·  theme ENVBANNER (was WIRING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No environment/“test only” banner: the subtitle says “Test Sign-in” but nothing marks the whole screen as non-production, and nothing prevents it from being linked from the production login (auth/env.ts:11 picks the login path from the same flag).
- **Verified evidence:** Subtitle says 'Test Sign-in' (page.tsx:67) but there is no environment banner. auth/env.ts:11 defaultLoginPath returns /auth/dev only when the flag is on, and middleware.ts:93 redirects /auth/dev to /auth/login when off, so production login does not link to it unless the flag is set. The real gap is the missing non-production banner.
- **Files to change:** `apps/web/src/app/auth/dev/page.tsx`
- **Fix steps:**
  1. Add a prominent 'TEST ENVIRONMENT - not for production data' banner (role=note) at top of the card.
  2. Show it using DS warning tokens.
- **Acceptance:**
  - Manual: /auth/dev with flag on shows the banner.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-AUTH-DEV-04  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Native submit has no pending state or disabled button (page.tsx:80) — double submits create two sessions; labels and autocomplete are correct (a11y ok).
- **Verified evidence:** Form is a native POST (page.tsx:73) with a submit button without disabled/pending handling (page.tsx:88); a double click sends two POSTs, each mints a stateless JWT cookie (route.ts:158-164), so 'two sessions' is accurate but harmless since the cookie is overwritten. Labels/autocomplete OK. Server does not zod-validate fields either (route.ts:145-149).
- **Files to change:** `apps/web/src/app/auth/dev/page.tsx`, `apps/web/src/app/api/auth/dev-login/route.ts`
- **Fix steps:**
  1. Convert the form to a small client component that disables the button on submit (useFormStatus or onSubmit).
  2. Add a zod schema in route.ts for username/password/tenant/next.
- **Acceptance:**
  - Manual: double-click Sign in sends one request.
  - Test: route rejects non-string username.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-AUTH-DEV-05  ·  LOW  ·  partly  ·  theme DEADCODE (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** All colours are inline hex (#0f172a, #6366f1, …) outside the DS tokens, no dark-mode variant and a ◈ glyph badge; the layout redirect uses a cookie civitasone_demo_auth that no code in apps/web sets — dev-login sets civitasone_at (route.ts:162) — so the layout redirect never fires (auth/layout.tsx:6).
- **Verified evidence:** Inline hex colours throughout page.tsx:7-36, no dark mode, and '◈' badge (line 65, aria-hidden). The second claim is true: auth/layout.tsx:6 checks cookie civitasone_demo_auth, and grep finds it set nowhere in apps/web; dev-login sets civitasone_at (route.ts:162). So the layout redirect is dead code and already signed-in users are not redirected from /auth/*. Middleware auth may handle it separately (not checked).
- **Files to change:** `apps/web/src/app/auth/layout.tsx`, `apps/web/src/app/auth/dev/page.tsx`
- **Fix steps:**
  1. In auth/layout.tsx check the real session cookie (COOKIE.ACCESS from lib/auth/config, name civitasone_at) or remove the layout redirect.
  2. Move dev page colours to DS tokens (low priority for a dev page).
- **Acceptance:**
  - Manual: signed-in user opening /auth/login is redirected to /dashboard (if intended).
  - No reference to civitasone_demo_auth remains.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Redirect loops possible if cookie is expired but present; validate not just presence.


---
## /auth/forgot  —  `auth/forgot.html`

- **Source:** `apps/web/src/app/auth/forgot/page.tsx`
- **Design reference:** `redesign/auth/forgot.html`

### GAP-AUTH-FORGOT-01  ·  HIGH  ·  confirmed  ·  theme FALSESUCCESS (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Every outcome, including a 404 from the non-existent /api/auth/forgot, is shown as “we've sent password reset instructions” (ForgotForm.tsx:38-49, 53-66). No reset email is ever sent; users wait for mail that never arrives with no error path.
- **Verified evidence:** ForgotForm.tsx:46-50 posts to /api/auth/forgot, swallows errors; finally sets done=true (lines 51-54). apps/web/src/app/api/auth has only callback, dev-login, login, logout, session, so the fetch 404s. Code comment (43-45) admits identity-service has no reset route. Success panel 'Check your inbox' shows regardless. Theme PII is wrong; it is a false-success flow.
- **Files to change:** `apps/web/src/app/auth/forgot/ForgotForm.tsx`, `apps/web/src/app/auth/forgot/page.tsx`, `apps/web/src/app/auth/login/LoginClient.tsx`
- **Fix steps:**
  1. Decide owner: Keycloak handles credentials (login/route.ts uses OIDC), so either add a real /api/auth/forgot that redirects to the Keycloak reset-credentials URL, or remove the page and the Reset link.
  2. If kept: show the neutral success only when the POST returned 2xx/202; on network or 5xx show an error with retry.
  3. Replace copy with 'Contact IT / use organisation SSO recovery' if no email flow exists.
- **Acceptance:**
  - Test: fetch 404 -> form shows error, not 'Check your inbox'.
  - Manual: real flow delivers an email or redirects to Keycloak.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Users locked out believing mail is coming; enumeration safety must be preserved for real flow.
- **Depends on:** GAP-AUTH-LOGIN-01

### GAP-AUTH-FORGOT-02  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** “The link expires in 30 minutes” (ForgotForm.tsx:63) is a hard-coded claim about a flow with no backend — false assurance on a security screen.
- **Verified evidence:** ForgotForm.tsx:68 (observation says 63) states 'The link expires in 30 minutes' unconditionally; no backend exists so the claim is invented.
- **Files to change:** `apps/web/src/app/auth/forgot/ForgotForm.tsx`
- **Fix steps:**
  1. Remove the expiry sentence, or source it from the real endpoint response once implemented.
- **Acceptance:**
  - Manual: success text has no expiry claim until backed by API.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-AUTH-FORGOT-01

### GAP-AUTH-FORGOT-03  ·  MEDIUM  ·  confirmed  ·  theme COPY (was ROLEGATE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Identity is delegated to Keycloak (login/page.tsx) so a local reset flow may be the wrong owner altogether; the user is not told to use the organisation SSO recovery or to contact IT.
- **Verified evidence:** Auth is Keycloak OIDC (api/auth/login/route.ts uses buildAuthorizeUrl); the forgot page does not mention SSO recovery or contacting IT (page.tsx:8, ForgotForm.tsx). Whether the Keycloak realm enables 'forgot password' is cannot-verify.
- **Files to change:** `apps/web/src/app/auth/forgot/page.tsx`, `apps/web/src/app/auth/forgot/ForgotForm.tsx`
- **Fix steps:**
  1. Confirm with identity owner whether Keycloak reset is enabled.
  2. Replace description with guidance to use the organisation sign-in recovery or contact IT, with a real contact channel.
- **Acceptance:**
  - Manual: page tells user the correct recovery route.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-AUTH-FORGOT-01

### GAP-AUTH-FORGOT-04  ·  MEDIUM  ·  partly  ·  theme ANTIABUSE (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No anti-automation: no rate limit, captcha or throttle copy; the page echoes the typed email back on the success panel (ForgotForm.tsx:60), fine for privacy but shown in plain text on a shared screen.
- **Verified evidence:** No rate limit/captcha anywhere for /api/auth/forgot (which does not exist). ForgotForm.tsx:67 echoes the typed email back on the success panel; it is the user's own input, low privacy impact. Client validation exists (EMAIL_RE line 18, submit disabled while sending line 106). Theme PII is overstated.
- **Files to change:** `apps/web/src/app/auth/forgot/ForgotForm.tsx`
- **Fix steps:**
  1. When the real endpoint is built, add server-side throttling per IP/email.
  2. Optionally drop the echoed email from the confirmation.
- **Acceptance:**
  - Test: 6 rapid requests -> 429 once endpoint exists.
- **Needs:** backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-AUTH-FORGOT-01

### GAP-AUTH-FORGOT-05  ·  LOW  ·  partly  ·  theme STYLE (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Route uses PageShell (min-h-screen bg-slate-50, left-aligned h1) while login/dev use a centred dark card — three auth screens, three visual languages; Tailwind literals instead of DS tokens.
- **Verified evidence:** forgot/page.tsx:8 uses PageShell (min-h-screen bg-slate-50, left h1 text-3xl, PageShell.tsx:16-24); login/dev use dark gradient cards; all use Tailwind slate/indigo literals. It is a style inconsistency, not fabricated data.
- **Files to change:** `apps/web/src/app/auth/forgot/page.tsx`, `apps/web/src/app/auth/layout.tsx`
- **Fix steps:**
  1. Create a shared AuthShell (centred card) in app/_components and use it in login, forgot and dev.
  2. Use DS tokens.
- **Acceptance:**
  - Manual: three auth screens share layout.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /auth/login  —  `auth/login.html`

- **Source:** `apps/web/src/app/auth/login/page.tsx`
- **Design reference:** `redesign/auth/login.html`

### GAP-AUTH-LOGIN-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** “Reset password” (LoginClient.tsx:39) goes to /auth/forgot, but authentication is delegated to Keycloak and no /api/auth/forgot route exists (api/auth has callback, dev-login, login, logout, session only). The link promises a flow the platform cannot complete.
- **Verified evidence:** LoginClient.tsx:41 (observation 39) links Reset password to /auth/forgot, which posts to non-existent /api/auth/forgot (api/auth has callback, dev-login, login, logout, session). Theme PII is wrong.
- **Files to change:** `apps/web/src/app/auth/login/LoginClient.tsx`
- **Fix steps:**
  1. Remove the link or point it to the Keycloak reset-credentials URL (from getOidcConfig), pending decision in AUTH-FORGOT-01.
- **Acceptance:**
  - Manual: link leads to a working flow or is absent.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-AUTH-FORGOT-01

### GAP-AUTH-LOGIN-02  ·  MEDIUM  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The `next` parameter is dropped: page.tsx passes no `next` to LoginClient and “Try again” is a fixed /api/auth/login (LoginClient.tsx:32), so a user who lands here from a deep link loses their destination after retrying.
- **Verified evidence:** login/page.tsx accepts searchParams.next in its type but does not pass it on (line 133,139), and 'Try again' is fixed /api/auth/login (LoginClient.tsx:49). But api/auth/login/route.ts (GET, no args) does not read a next parameter at all, so the destination is not carried through the OIDC flow anywhere; fix needs the route and callback too.
- **Files to change:** `apps/web/src/app/auth/login/page.tsx`, `apps/web/src/app/auth/login/LoginClient.tsx`, `apps/web/src/app/api/auth/login/route.ts`, `apps/web/src/app/api/auth/callback/route.ts`
- **Fix steps:**
  1. In login route read validated ?next (same-origin path check as dev-login route.ts:160) and store in a short-lived cookie.
  2. In callback redirect to it after success.
  3. Pass next from page.tsx to LoginClient and append to the Try again href.
- **Acceptance:**
  - Manual: open /dashboard/x unauthenticated, fail login, retry -> lands on /dashboard/x.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Open-redirect risk; must validate path starts with single '/'.

### GAP-AUTH-LOGIN-03  ·  MEDIUM  ·  confirmed  ·  theme I18N

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Fallback copy prints the raw OIDC error string (“Authentication failed (invalid_state)”, LoginClient.tsx:28); no support reference is given, and “Need help? Contact IT” has no contact channel.
- **Verified evidence:** LoginClient.tsx:39 (28 in observation) prints `Authentication failed (${error ?? 'unknown'})` with the raw query value; 'Need help? Contact IT' (line 52) has no channel. Only two error codes are mapped.
- **Files to change:** `apps/web/src/app/auth/login/LoginClient.tsx`
- **Fix steps:**
  1. Map known OIDC errors (invalid_state, etc.) to friendly text with a default generic message; show the code only as a small 'Reference' string.
  2. Add a contact link/email from config.
- **Acceptance:**
  - Test: error=invalid_state renders friendly copy.
  - Manual: contact channel visible.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; raw param is React-escaped.

### GAP-AUTH-LOGIN-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Suspense fallback is an empty dark box (page.tsx:14) — no branding or status text; screen readers get nothing.
- **Verified evidence:** page.tsx:138 Suspense fallback is `<main className='min-h-screen bg-slate-900' />` with no content or aria status.
- **Files to change:** `apps/web/src/app/auth/login/page.tsx`
- **Fix steps:**
  1. Replace fallback with the brand block plus role='status' text 'Loading sign-in...'.
  2. Note LoginClient uses useSearchParams which needs the Suspense boundary.
- **Acceptance:**
  - Manual: fallback shows branding and is announced by screen readers.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-AUTH-LOGIN-05  ·  LOW  ·  partly  ·  theme STYLE (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Page uses Tailwind slate/indigo literals and a dark gradient unrelated to the CivitasOne tokens used everywhere else (LoginClient.tsx:14-21); “Try again” is an anchor styled as a button on a page with no <h1> landmark hierarchy beyond one heading.
- **Verified evidence:** LoginClient.tsx:14-21 (actual 161-165) uses slate/indigo literals and gradient; 'Try again' is an <a> styled as a button (semantically fine for navigation). It has an h1 and main landmark, so hierarchy claim is weak. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/auth/login/LoginClient.tsx`
- **Fix steps:**
  1. Use the shared AuthShell/DS tokens (see AUTH-FORGOT-05).
- **Acceptance:**
  - Visual check against DS.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-AUTH-FORGOT-05


---
## Backend verification items (service code absent from snapshot)

### GAP-AUTH-DEV-06  ·  LOW  ·  partly  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Account roles behind the demo usernames are seeded outside this snapshot — the descriptions (e.g. “Audit · Legal”) cannot be verified.
- **Service:** `identity-service`  ·  **Endpoint(s):** `['POST /api/auth/dev-login (web-local)', 'seed: scripts/demo/seed-demo.mjs']`
- **Question:** Do the seeded demo personas' roles match the descriptions on the dev page (e.g. auditor = Audit + Legal)?
- **How to verify:** Compare USERS map in apps/web/src/app/api/auth/dev-login/route.ts with identity-service/Keycloak seed (scripts/demo/seed-demo.mjs). Note web map gives auditor roles audit_officer, audit_admin, reader, viewer only - no legal role.
- **Test to add:** Given persona 'auditor'; when logged in; then role set equals the roles listed in the dev page description (test compares page copy to USERS roles).
- **Impact if wrong:** Misleading demo/training; wrong expectations of access in UAT.
- **Web change if wrong:** Fix description at auth/dev/page.tsx:97 ('Audit · Legal') to match roles, or add legal role.
- **Finding:** api/auth/dev-login/route.ts auditor persona roles: audit_officer, audit_admin, reader, viewer; auth/dev/page.tsx:97 says 'Audit · Legal'

### GAP-AUTH-FORGOT-06  ·  LOW  ·  partly  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** identity-service is not in the snapshot — reset token issuance, expiry and email delivery are undeterminable.
- **Service:** `identity-service`  ·  **Endpoint(s):** `['POST /api/auth/forgot (no route in web app)']`
- **Question:** Does identity-service expose a password-reset route that issues an expiring single-use token and sends email?
- **How to verify:** Search identity-service routes for reset/forgot; ForgotForm.tsx comment states none exists. Web has no apps/web/src/app/api/auth/forgot route, so request 404s.
- **Test to add:** Given a registered email; when POST /identity/password-reset/request; then 202 with same body for unknown emails, token expires in <=30 min, single use, email enqueued.
- **Impact if wrong:** Users cannot recover accounts while UI claims an email was sent (false assurance).
- **Web change if wrong:** Until implemented, change confirmation copy to direct users to their administrator; add /api/auth/forgot proxy when service exists.
- **Finding:** apps/web/src/app/auth/forgot/ForgotForm.tsx:30-38 (comment: identity-service does not yet expose reset; 404 treated as success); no api/auth/forgot route under apps/web/src/app/api/auth

### GAP-AUTH-LOGIN-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Identity-service / Keycloak realm are not in the snapshot — error codes emitted by /api/auth/callback are undeterminable.
- **Service:** `identity-service`  ·  **Endpoint(s):** `['GET /api/auth/callback (web) -> Keycloak token endpoint', 'POST /api/identity/sessions']`
- **Question:** Which error codes can /api/auth/callback redirect with, and does login/page.tsx map all of them?
- **How to verify:** Web callback emits invalid_callback and token_exchange_failed (callback/route.ts:32,71); check Keycloak realm/identity-service for others (access_denied, session create failures) and compare with the map in auth/login/page.tsx.
- **Test to add:** Given each error code emitted by callback; when /auth/login?error=<code>; then a specific message renders, unknown code shows generic message.
- **Impact if wrong:** Users see blank/unhelpful login failures.
- **Web change if wrong:** Add missing codes to the login error map.
