# Detailed gap file — module `domains`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 5, BACKEND-VERIFY 1



---
## /domains/new  —  `domains/new.html`

- **Source:** `apps/web/src/app/(app)/domains/new/page.tsx`
- **Design reference:** `redesign/domains/new.html`

### GAP-DOMAINS-NEW-01  ·  HIGH  ·  defect  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Both post-save targets are dead: the page links back to /domains and, on success, routes to /domains/{id} (page.tsx:66,79) but the snapshot contains only apps/web/src/app/(app)/domains/new — no /domains index or [id] route — so a successful registration lands on a 404.
- **Service:** ``  ·  **Endpoint(s):** `['POST /api/v1/domains']`
- **Question:** 
- **How to verify:** 
- **Test to add:** 
- **Impact if wrong:** 
- **Web change if wrong:** 
- **Finding:** apps/web/src/app/(app)/domains contains only new/; page.tsx:66,79 route to /domains and /domains/{id}, which do not exist in the snapshot. Verified by ls.

### GAP-DOMAINS-NEW-02  ·  HIGH  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Validation contradicts its message: regex /^[a-z0-9.-]+\.(gov\.in|nic\.in|gov\.in|in)$/i (gov\.in listed twice) accepts any ".in" host such as example.co.in, while the error says ".gov.in or .nic.in" (page.tsx:42-43). Domain Type is never cross-checked against the typed name, and "Other" is offered although no non-.in name can pass.
- **Verified evidence:** domains/new/page.tsx:42 regex /^[a-z0-9.-]+\.(gov\.in|nic\.in|gov\.in|in)$/i : the 'in' alternative subsumes the others, so example.co.in, foo.in pass; message at :43 says '.gov.in or .nic.in'. domainType (default 'gov.in', options :137-140: gov.in, nic.in, state.gov.in, other) is never compared to domainName, and 'Other' is selectable though the regex rejects non-.in names. Whole form object is posted (:59). Backend validation not verifiable.
- **Files to change:** `apps/web/src/app/(app)/domains/new/page.tsx`, `apps/web/src/app/(app)/domains/schema.ts (new, zod)`
- **Fix steps:**
  1. Create a zod schema domainSchema: domainName regex ^[a-z0-9-]+(\.[a-z0-9-]+)*\.(gov\.in|nic\.in)$ (confirm allowed suffixes with product), plus superRefine that domainType matches the suffix (state.gov.in requires state).
  2. Either remove 'Other' or relax rule for it with explicit message.
  3. Use schema.safeParse(form) in handleSubmit and map issues to fieldErrors; server must validate with the same schema (share via packages).
  4. Fix message to list exactly the accepted suffixes.
- **Acceptance:**
  - example.co.in rejected; example.gov.in accepted.
  - domainType nic.in with a .gov.in name shows a field error.
  - 'Other' behaves as specified.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Domain registry integrity: accepting wrong domains pollutes GovUX audit data; tightening may reject legacy entries, confirm allowed TLDs first.

### GAP-DOMAINS-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Email validated only by includes("@") (page.tsx:45); native type=email plus required will usually pre-empt the custom message. Phone has no format check.
- **Verified evidence:** Email check at domains/new/page.tsx:45 is includes('@'); input is type='email' with required (:201,206) and the <form> has no noValidate, so the browser's native validation blocks submit before handleSubmit for most bad values, making the custom message mostly unreachable. Phone (:223-231) is type='tel' with no pattern/validation. Theme PII is wrong (nothing is masked/displayed).
- **Files to change:** `apps/web/src/app/(app)/domains/new/page.tsx`, `apps/web/src/app/(app)/domains/schema.ts (new, zod)`
- **Fix steps:**
  1. Use the same zod schema: z.string().email() for contactEmail; optional phone regex for Indian formats (+91 / STD-number) with clear message.
  2. Add noValidate to <form> so the custom accessible messages are shown consistently.
  3. Trim inputs before validation.
- **Acceptance:**
  - 'a@b' rejected with the custom message (with noValidate).
  - '011-24301001' and '+91 9876543210' accepted; 'abc' rejected.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-DOMAINS-NEW-02

### GAP-DOMAINS-NEW-04  ·  MEDIUM  ·  partly  ·  theme DESIGN-SYSTEM (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Design-system drift: hard-coded hex colours (#4f46e5 primary, #d1d5db borders, #b42318 errors) and unlabelled inline-styled buttons instead of ds Button / form components (page.tsx:8-10,251-272); primary button turns grey #9ca3af while busy.
- **Verified evidence:** Hard-coded hex confirmed: #d1d5db (:8,111,205,254), #b42318 (:10,87), #fef2f2/#fecaca (:87), #dc2626 (:111,205), #4f46e5/#9ca3af/#f3f4f6/#374151 (:254,264), none dark-mode aware; native <button> with inline style instead of ds Button / .btn primary. Overstated: buttons are not 'unlabelled', they have text ('Cancel', 'Register Domain'). Ds has no shared input component (see NEW-04). Theme is design-system drift, not FABRICATED.
- **Files to change:** `apps/web/src/app/(app)/domains/new/page.tsx`, `apps/web/src/app/_components/ds/FormField.tsx (new)`
- **Fix steps:**
  1. Replace the two buttons with ds <Button variant> (or className='btn primary' / 'btn') and keep disabled={busy}.
  2. Replace hex with tokens (var(--line), var(--bad), var(--accent)); error box uses the same color-mix pattern as documents/new.
  3. Move inputStyle to a shared .input class or FormField.
- **Acceptance:**
  - grep for '#' hex in domains/new/page.tsx returns none.
  - Dark mode: inputs and error box remain legible.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-DOCUMENTS-NEW-04

### GAP-DOMAINS-NEW-06  ·  LOW  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1925 — Per-keystroke lowercasing removed (lowercase on blur/submit); state select still has no tenant-state default
- **First-pass claim:** State / UT is a native select element of 36 items with no default of the tenant's state; domain name is lower-cased on every keystroke (page.tsx:109), which moves the caret in the middle of the text.
- **Verified evidence:** State select has 36 options (INDIAN_STATES :12-20, 28 states + 8 UTs) with placeholder '— Select state / UT —' (:187); a tenant default is not verifiable (no tenant-state source seen in the page). Lowercasing on each keystroke at :109 is real: controlled input value differs from typed text when an uppercase char is entered mid-string, so React resets the caret to the end. A native select of 36 is acceptable; the caret bug is the real defect.
- **Files to change:** `apps/web/src/app/(app)/domains/new/page.tsx`
- **Fix steps:**
  1. Store raw input; lowercase only on blur and in the submit payload (domainName.trim().toLowerCase()); or add CSS text-transform: lowercase for display.
  2. Optionally prefill state from tenant profile if a source exists.
- **Acceptance:**
  - Type 'ABC.gov.in', move caret to the middle and type 'X': caret stays in place.
  - Submitted value is lower-case.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## Backend verification items (service code absent from snapshot)

### GAP-DOMAINS-NEW-05  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1925 — DPDP purpose notice added and layout.tsx requireAnyRole admin gate; server enforcement/audit unverifiable (no backend)
- **First-pass claim:** Contact email and phone are personal data (DPDP) collected with no purpose or consent note and no indication of an audit entry for the create; backend absent — undeterminable. No module gate: any authenticated user reaches the form (no layout.tsx).
- **Service:** `domain-service`  ·  **Endpoint(s):** `['POST /api/v1/domains']`
- **Question:** Does the create handler require an authorised role, validate email/phone with zod, and emit an audit event including PII-safe payload?
- **How to verify:** Open the domains POST handler in domain-service; call as a role with no domain-admin right expecting 403; check audit emit and that contact fields are not logged in clear.
- **Test to add:** Given a non-admin user when POST /v1/domains then 403; given admin then 201 and one audit event without raw email/phone.
- **Impact if wrong:** DPDP exposure and unauthorised domain registration.
- **Web change if wrong:** Add a role gate layout for /domains and a purpose/consent notice next to contact fields in domains/new/page.tsx.
