# Auth — Login Screen

**SPRINT:** 1
**ROUTE:** `/auth/login`
**MODULE:** Auth
**EDITION:** All
**PRIMARY ROLE:** Any authenticated user (system user, citizen, vendor)

---

## Figma Make prompt

```
Generate the Login screen for CivitasOne Suite.

PURPOSE: Authenticate a user via username + password, optionally via SSO,
optionally with MFA step-up. Renders inside AuthShell template.

LAYOUT: AuthShell — centered card on tenant brand background

PRIMARY REGIONS:
- Brand region (top of card): tenant logo + product name "CivitasOne Suite"
- Heading: text.h2 "Sign in to your workspace"
- Subheading: text.body-sm "{{tenant.displayName}}"
- Tenant identifier input (if multi-tenant gateway — auto-resolved from subdomain otherwise)
- Email / username input (FormField with autofocus)
- Password input (FormField with show/hide toggle, autocomplete=current-password)
- "Forgot password?" link (text.body-sm, intent.primary)
- Primary button: "Sign in" (full width, primary, size lg)
- Divider with text "or continue with"
- SSO buttons: Keycloak OIDC, SAML — one per configured provider
- Footer link: "Don't have an account? Contact your admin" (text.caption)

STATES:
- Default: form ready, primary button enabled when both fields filled
- Loading: primary button shows spinner, all inputs disabled
- Error (invalid credentials): inline Banner with intent.danger above the form,
  message from ApiError.message, correlation ID shown in small text
- Error (MFA required): show MFA step screen (separate prompt)
- Error (account locked): Banner with intent.warning, "Account locked — contact admin"
- Success: full-page transition to /dashboard

ACTIONS:
- Primary: Submit credentials → POST /auth/login
- Forgot password: navigate to /auth/forgot
- SSO: redirect to /auth/sso/{provider}

KEYBOARD:
- Enter submits the form
- Tab order: tenant → username → password → submit → forgot → SSO buttons

ACCESSIBILITY:
- All inputs have <label> via FormField
- Password field announces show/hide state to screen readers
- Banner uses role="alert" for live announcement of errors
- Focus moves to first error field after a failed submit
- Form has aria-label="Sign in"

THEMING:
- Background uses tenant brand gradient (tokens: brand.primary → brand.secondary)
- Card uses surface.raised on top of background
- Dark mode: background dimmed, card on surface.raised-dark

LOCALISATION:
- All copy translatable via ICU keys: auth.signin.heading, auth.signin.email,
  auth.signin.password, auth.signin.submit, auth.signin.forgot, auth.signin.sso_divider

OUT OF SCOPE:
- Signup flow (CivitasOne is admin-provisioned only — Vol 1)
- Social login (Google/GitHub) — not supported for Govt/PSU
- "Remember me" — sessions follow security policy from policy-service
```

## Render variants

Generate the screen in the following arrangement on the same Figma page:

1. Default (desktop, light, en-IN) — top-left
2. Default (desktop, dark, en-IN) — top-right
3. Default (mobile 375px, light) — middle-left
4. Default (mobile 375px, dark) — middle-right
5. Error state (invalid credentials) — bottom-left
6. Loading state — bottom-right
7. RTL variant (ar-SA, light) — far right
