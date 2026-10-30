# Detailed gap file — module `pricing`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 6, BACKEND-VERIFY 1



---
## /pricing  —  `pricing/home.html`

- **Source:** `apps/web/src/app/(marketing)/pricing/page.tsx`
- **Design reference:** `redesign/pricing/home.html`

### GAP-PRICING-HOME-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Primary conversion link is dead: PSU CTA "Start Free Trial" goes to /auth/register?plan=psu (page.tsx:29) but the auth segment contains only dev, forgot and login (apps/web/src/app/auth), so the most-promoted plan's button 404s.
- **Verified evidence:** apps/web/src/app/(marketing)/pricing/page.tsx:33 ctaHref '/auth/register?plan=psu' for the highlighted PSU plan; apps/web/src/app/auth contains only dev, forgot, login (+layout.tsx); grep finds no other reference to /auth/register and no register route or rewrite. middleware.ts PUBLIC includes /auth so it would 404, not redirect. Note the plan is also literally labelled 'Free Trial' with no backend to provision one.
- **Files to change:** `apps/web/src/app/(marketing)/pricing/page.tsx`, `apps/web/src/app/(marketing)/contact/page.tsx`
- **Fix steps:**
  1. Decide: build /auth/register or point the PSU CTA at /contact?plan=psu (existing route).
  2. If pointing to /contact, change ctaHref (line 33) and CTA label to 'Request a demo' unless a trial really exists.
  3. Have contact/page.tsx read the plan query param to prefill the interest field.
  4. Add an e2e link-check test over pricing CTAs.
- **Acceptance:**
  - Clicking the PSU CTA lands on a 200 page.
  - Playwright test: all hrefs on /pricing resolve (non-404).
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Public conversion path; no data risk.

### GAP-PRICING-HOME-02  ·  HIGH  ·  partly  ·  theme COPY (was PII)

- [x] **Status** (W2 PQ: closed by this PR; FAQ answer now reads 'designed to support GFR 2017... These are design goals, not a claim of formal certification' — apps/web/src/app/(marketing)/pricing/page.tsx:81-82 verified)
- **W0 note:** partly fixed by #1925 — FAQ rewritten to 'design goals, not a claim of certification'; legal approval of the wording is not recorded.
- **First-pass claim:** Unqualified compliance claim in the FAQ: "CivitasOne is built to meet GFR 2017 procurement norms, DPDP Act data protection requirements, and CERT-In security guidelines" (page.tsx:75-76) is stated as fact on a public page with no certification or scope; a procurement officer will quote it.
- **Verified evidence:** apps/web/src/app/(marketing)/pricing/page.tsx:81-82 FAQ answer states 'Yes. CivitasOne is built to meet GFR 2017 procurement norms, DPDP Act data protection requirements, and CERT-In security guidelines.' Confirmed as unqualified public claim. Whether the product meets them is not verifiable from this page; CLAUDE.md/docs/SECURITY.md reference DPDP/CERT-In as design targets, not certifications. Theme PII is wrong.
- **Files to change:** `apps/web/src/app/(marketing)/pricing/page.tsx`
- **Fix steps:**
  1. Get legal/compliance sign-off on wording.
  2. Rewrite to 'designed to support' + name the controls (audit trail, encryption), and state that certification/empanelment status is available on request.
  3. Link to /docs security page if one exists.
  4. Change 'Yes.' to a non-committal opening.
- **Acceptance:**
  - FAQ no longer asserts compliance as fact; legal approval recorded.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Reputational/procurement risk from an unverifiable compliance claim.

### GAP-PRICING-HOME-03  ·  MEDIUM  ·  partly  ·  theme COPY (was MONEY)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Pricing contradicts the landing page: pricing lists PSU at ₹15,000/month (page.tsx:23) while the landing hero says "₹0 licensing" ((marketing)/page.tsx:60) and the comparison table shows Licensing/year ₹0 (line 32).
- **Verified evidence:** apps/web/src/app/(marketing)/pricing/page.tsx:13,24 show Small Office ₹0/month and PSU ₹15,000/month; landing (marketing)/page.tsx hero says 'Zero training. ₹0 licensing.' and comparison row 'Licensing/year ₹0' for CivitasOne. That is consistent for Small Office only; the landing claim is unqualified so it conflicts with the PSU price. Amounts are hard-coded display strings, not paise math.
- **Files to change:** `apps/web/src/app/(marketing)/page.tsx`, `apps/web/src/app/(marketing)/pricing/page.tsx`
- **Fix steps:**
  1. Qualify the landing copy: '₹0 licensing for Small Office' and compare against SAP/Oracle for PSU with the real price.
  2. Keep prices in one shared constants module used by both pages.
  3. Have finance/product confirm ₹15,000/month.
- **Acceptance:**
  - Landing and pricing state the same figures per edition.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Misleading price claims on a public page.

### GAP-PRICING-HOME-05  ·  MEDIUM  ·  partly  ·  theme THEME (was FABRICATED)

- [x] **Status** Closed per owner decision D4c #16 (2026-10-27): public pricing page stays light-only (same ruling as the contact page); accepted.
- **W0 note:** partly fixed by #1925 — marketing layout is now explicitly light-only (color-scheme: light); pricing CTA still uses hard-coded gray-900 Tailwind classes, not a brand colour token.
- **First-pass claim:** Page is styled with hard-coded Tailwind grays and gray-900 buttons (page.tsx:84-160), not the design-system tokens the app uses, so it has no dark mode and its highlight/CTA colours differ from the product brand.
- **Verified evidence:** Pricing page uses hard-coded Tailwind classes (bg-white, text-gray-900, bg-gray-900; lines 90-168) rather than design tokens. Marketing site uses Tailwind classes throughout (landing page identical style), so it is a consistent marketing style, not a token bypass unique to pricing; dark mode absence is true (no dark: variants; (marketing)/layout.tsx has none). Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(marketing)/pricing/page.tsx`, `apps/web/src/app/(marketing)/layout.tsx`
- **Fix steps:**
  1. Decide whether marketing should follow the app tokens; if so map gray-900/gray-50 to CSS-variable-backed Tailwind theme colours in tailwind config.
  2. Add dark: variants or explicitly declare marketing light-only.
- **Acceptance:**
  - Pricing CTA uses brand colour token.
  - Dark theme renders legibly or is explicitly disabled.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Visual only.

### GAP-PRICING-HOME-06  ·  LOW  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** "Annual billing saves 15%" (FAQ) has no annual price anywhere; "Start Free Trial" gives no trial length; the Small Office "SLA: —" prints a dash as a value (page.tsx:19,131).
- **Verified evidence:** apps/web/src/app/(marketing)/pricing/page.tsx:18 sla '—' rendered as 'SLA: —' (line 136); FAQ line 74 'Annual billing saves 15%' with no annual price shown; CTA 'Start Free Trial' (line 32) gives no length.
- **Files to change:** `apps/web/src/app/(marketing)/pricing/page.tsx`
- **Fix steps:**
  1. For plans without SLA, omit the SLA row or write 'SLA: none (community)'.
  2. Show annual price/discount amount or drop the 15% sentence.
  3. State trial length or rename CTA (see HOME-01).
- **Acceptance:**
  - No list item renders a bare dash as a value.
  - FAQ 15% claim has a matching annual price.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-PRICING-HOME-01

### GAP-PRICING-HOME-07  ·  LOW  ·  partly  ·  theme A11Y (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Plan checkmarks are literal "✓" text (page.tsx:112-131) read aloud as "check mark" before every item; "Most Popular" badge is absolutely positioned and will clip in narrow columns.
- **Verified evidence:** Checkmarks are literal '✓' spans without aria-hidden (lines 124-136) so screen readers announce them; confirmed. 'Most Popular' badge is `absolute -top-3 start-6` (line 113) on a relative card with p-8; a short badge fits at md:grid-cols-3, clipping is unlikely and unverified (no overflow-hidden on the card). Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(marketing)/pricing/page.tsx`
- **Fix steps:**
  1. Add aria-hidden='true' to each check span or replace with a lucide Check icon with aria-hidden.
  2. Wrap plan features in ul with list semantics already present; keep.
  3. Verify badge at 768px width.
- **Acceptance:**
  - Screen reader output does not read 'check mark' per item.
  - Badge fully visible at 768px.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## Backend verification items (service code absent from snapshot)

### GAP-PRICING-HOME-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: verified — billing-service present; GET /v1/billing/plans carries only price+code, not module count/users/storage/SLA; pricing.ts documents the decision: marketing numbers are reviewed static copy. Contract test deferred to billing-service team (different PR scope))
- **First-pass claim:** Hard-coded facts that should come from entitlements: "All 33" modules, 25/500 users, 10/100 GB, 99.5%/99.9% SLA (page.tsx:17-43); the Government plan modules line reads "All 33 + dedicated support", mixing a module count with a support tier. Undeterminable whether billing plans (/billing/plans) match: billing-service not in snapshot.
- **Service:** `billing-service`  ·  **Endpoint(s):** `['GET /api/v1/billing/plans']`
- **Question:** Do billing plans return module count, user limit, storage and SLA matching the marketing figures (33 modules, 25/500 users, 10/100 GB, 99.5/99.9%)?
- **How to verify:** Open billing-service plans seed/route; compare limits with (marketing)/pricing/page.tsx:17-43.
- **Test to add:** Given plans seeded, when GET billing/plans, then plan.limits equal the values rendered on /pricing (contract test).
- **Impact if wrong:** Published price/limits differ from contract.
- **Web change if wrong:** Load /pricing figures from the plans endpoint (public) and split 'All 33 + dedicated support' into two lines.
