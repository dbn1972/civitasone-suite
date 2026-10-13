# Detailed gap file — module `contact`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 5, BACKEND-VERIFY 1



---
## /contact  —  `contact/home.html`

- **Source:** `apps/web/src/app/(marketing)/contact/page.tsx`
- **Design reference:** `redesign/contact/home.html`

### GAP-CONTACT-HOME-01  ·  HIGH  ·  confirmed  ·  theme OTHER (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0-10 note:** review found the W0 tick partly — ContactForm with consent and server reference exists, but phone/address render only if NEXT_PUBLIC_CONTACT_PHONE/ADDRESS env set (contactDetails.ts:23-31), and middleware.ts:11 PUBLIC list lacks /contact and /api/contact so anonymous government visitors would be redirected to login (unless a proxy fronts them)
- **W1 note (2026-10-13):** #1997 added /contact and /api/contact to the middleware PUBLIC list (verified on main d341ad6f1). Still open: phone and address render only when NEXT_PUBLIC_CONTACT_PHONE/ADDRESS are set (business content decision).
- **First-pass claim:** Government buyers get only mailto links — no form, phone, postal address or response-time commitment (page.tsx:8-24); a departmental user without a configured mail client (typical on shared or kiosk PCs) has no way to make contact, and the page hands out the same address twice.
- **Verified evidence:** contact/page.tsx:8-24 define three channels, each rendered as an mailto anchor (:41-46); no form, phone, postal address or response-time statement. hello@civitasone.app appears twice (:12,:17). Whether a public contact API exists is cannot-verify.
- **Files to change:** `apps/web/src/app/(marketing)/contact/page.tsx`
- **Fix steps:**
  1. Decision: supply official phone, postal address and response-time commitment (business content) and add them to the page.
  2. Add an enquiry form (name, department, email, phone, message; zod-validated) posting to a public contact/lead endpoint (backend to provide; policy-service public route) with a consent line for DPDP.
  3. Keep mailto as secondary; add a copy-address button for kiosks.
  4. Add auto-reply/reference number on submit.
- **Acceptance:**
  - Form submits and shows a reference number; invalid email is rejected client-side.
  - Page lists phone, address and SLA.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** PII collection (DPDP notice/consent needed); spam protection required.

### GAP-CONTACT-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was I18N)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Sales & Government Procurement and General Inquiries both use hello@civitasone.app (page.tsx:10,16): two labelled channels, one inbox, so the 'we will route you' promise (page.tsx:31) is not backed by separate routing.
- **Verified evidence:** contact/page.tsx:12 and :17 both use hello@civitasone.app while :31-33 promises 'we will route you to the right person'. Routing behind the alias is cannot-verify.
- **Files to change:** `apps/web/src/app/(marketing)/contact/page.tsx`
- **Fix steps:**
  1. Decision: create separate mailboxes (e.g. sales@, info@) or collapse to one card.
  2. If one inbox stays, merge the cards and add a 'Topic' selector in the form (see CONTACT-01) so routing is data-driven.
  3. Reword line 31-33 if no routing exists.
- **Acceptance:**
  - Each channel card has a distinct address or the duplicate card is gone.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CONTACT-HOME-01

### GAP-CONTACT-HOME-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0-10 note:** review found the W0 tick partly — security.txt route + 2-day ack SLA + private-report copy exist, but no disclosure-policy section (scope, safe harbour, CERT-In) in contact/page.tsx; also middleware.ts:11 PUBLIC list lacks /.well-known so anonymous GET /.well-known/security.txt gets 302 to login (acceptance 200 text/plain not met unless proxy fronts it)
- **W1 note (2026-10-13):** #1997 added /.well-known to the middleware PUBLIC list (verified on main d341ad6f1). Still open: no disclosure-policy section (scope, safe harbour, CERT-In) on the contact page.
- **First-pass claim:** Security card says 'Please do not open a public issue' (page.tsx:21), assuming a public issue tracker a Government reader does not see; no disclosure policy, PGP key, security.txt or acknowledgement SLA is offered.
- **Verified evidence:** contact/page.tsx:21 says 'Please do not open a public issue'. Overstated: the footer links to a public GitHub (layout.tsx:76), so a public tracker is plausibly visible. Real: no disclosure policy, PGP key, acknowledgement SLA or /.well-known/security.txt exists (no public/ dir or route handler found in apps/web).
- **Files to change:** `apps/web/src/app/(marketing)/contact/page.tsx`, `apps/web/public/.well-known/security.txt (new) or app/.well-known/security.txt/route.ts (new)`
- **Fix steps:**
  1. Reword to 'Please report privately to security@... rather than a public issue'.
  2. Add a short disclosure policy section: scope, safe harbour, acknowledgement SLA (decision needed), CERT-In reference.
  3. Publish security.txt (Contact, Expires, Policy, optional Encryption) and link the PGP key if one exists.
- **Acceptance:**
  - GET /.well-known/security.txt returns 200 text/plain with Contact and Expires.
  - Card states acknowledgement SLA.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Commits the org to an SLA; needs security owner sign-off.

### GAP-CONTACT-HOME-04  ·  MEDIUM  ·  confirmed  ·  theme NAVUX (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Contact is reachable only from the footer (layout.tsx:82) and pricing; the header nav lists Products, Pricing, Docs only (layout.tsx:19-30), so the main conversion path from the header is missing.
- **Verified evidence:** marketing/layout.tsx:19-29 header nav has Products, Pricing, Docs only (right side: Try Sandbox, Sign In :31-43); Contact is only in the footer (:82) and pricing CTA (pricing/page.tsx:46). Also the nav block is 'hidden md:flex' (:19), so on mobile there are no nav links at all and no menu button.
- **Files to change:** `apps/web/src/app/(marketing)/layout.tsx`
- **Fix steps:**
  1. Add a 'Contact' Link to /contact in the desktop nav and a 'Contact sales' CTA button.
  2. Add a mobile menu (button + disclosure) that exposes all nav links including Contact.
- **Acceptance:**
  - Header shows Contact at >=768px; a mobile hamburger opens the same links.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** None.

### GAP-CONTACT-HOME-05  ·  LOW  ·  partly  ·  theme THEME (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Page uses hard-coded Tailwind gray-* and a white gradient (page.tsx:27), so it does not follow theme tokens or dark mode, unlike the app shell.
- **Verified evidence:** contact/page.tsx:28 and card classes use fixed Tailwind gray-*/white (bg-white, from-white to-gray-50, text-gray-900, border-gray-200). True, but the entire marketing group is the same: layout.tsx:13-100 hard-codes gray/white with no dark variant; (app) shell uses CSS variables. So this is a marketing-site-wide choice, not a page-specific fault.
- **Files to change:** `apps/web/src/app/(marketing)/contact/page.tsx`, `apps/web/src/app/(marketing)/layout.tsx`
- **Fix steps:**
  1. Decision: does the public marketing site need dark mode / DS tokens?
  2. If yes: introduce token classes (or tailwind dark: variants) in layout.tsx and pages together, not this page alone.
  3. If no: close as accepted.
- **Acceptance:**
  - If pursued: all marketing pages switch with prefers-color-scheme with contrast >=4.5:1.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Visual regression across marketing pages.


---
## Backend verification items (service code absent from snapshot)

### GAP-CONTACT-HOME-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No backend or form endpoint exists for contact; email routing and any ticketing behind hello@/security@ are outside the codebase: undeterminable.
- **Service:** `(none)`  ·  **Endpoint(s):** `['(none) mailto:hello@ / security@']`
- **Question:** Are hello@ and security@ mailboxes provisioned with routing/ticketing and a monitored SLA?
- **How to verify:** Check mail/DNS config and ticketing rules with ops; send a test mail to each address.
- **Test to add:** Given a test mail to security@, when sent, then a ticket or on-call alert is created within SLA.
- **Impact if wrong:** Vulnerability reports lost; medium.
- **Web change if wrong:** Add a contact form endpoint or update addresses.
