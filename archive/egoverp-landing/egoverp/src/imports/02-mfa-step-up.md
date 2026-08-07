# Auth — MFA Step-Up

**SPRINT:** 1
**ROUTE:** `/auth/mfa`

---

## Figma Make prompt

```
Generate the MFA Step-Up screen for CivitasOne Suite.

PURPOSE: After username/password, prompt for a TOTP or WebAuthn challenge.

LAYOUT: AuthShell — centered card

PRIMARY REGIONS:
- Brand region (tenant logo + product name)
- Heading: text.h2 "Verify your identity"
- Subheading: text.body "Enter the 6-digit code from your authenticator app"
- 6-digit OTP input (split into 6 boxes, auto-advance on type, paste supported)
- Primary button: "Verify"
- Secondary link: "Use a different method" (opens method picker drawer)
- Tertiary link: "I lost my device" (opens recovery flow)

ALTERNATE METHODS (method picker drawer):
- Authenticator app (TOTP) — default
- Security key (WebAuthn)
- Backup recovery codes
- SMS (only if enabled by tenant policy — discouraged for Govt)

STATES:
- Default: 6 empty boxes, first focused
- Typing: digits fill, auto-advance
- Loading: boxes locked, primary button shows spinner
- Error (invalid code): boxes flash intent.danger, Banner shown
- Error (too many attempts): account temporarily locked, Banner with countdown
- Success: redirect to /dashboard

ACCESSIBILITY:
- Each OTP box has aria-label "Digit 1 of 6", "Digit 2 of 6", etc.
- Live region announces remaining attempts on error
- Submit button disabled until all 6 boxes filled

THEMING + LOCALISATION: same as login screen

OUT OF SCOPE:
- MFA enrolment (covered in tenant-admin/04-mfa-enrol.md)
- Push notification approval (Phase 2)
```
