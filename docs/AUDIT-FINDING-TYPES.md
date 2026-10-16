# Audit Finding Types — Developer Reference

> **Audience:** CivitasOne development team and platform administrators.
> This catalogue is developer-maintained and identical for every tenant.
> It documents the *types* of findings the platform UX/accessibility/security
> review process produces.
>
> **GAP-LIBRARY-HOME-03:** This content was previously exposed in the
> tenant app UI at `/library` (behind PLATFORM_ADMIN_ROLES). Moving it
> here satisfies the acceptance criterion that developer-facing content
> lives in developer docs rather than the product UI.

---

## Code key

| Prefix | Domain |
|--------|--------|
| `W`    | Web finding (HTML/CSS/JS, browser environment) |
| `I`    | Interaction finding (focus, keyboard, pointer) |

---

## Severity levels

| Level    | Meaning |
|----------|---------|
| Critical | Blocks a user group from completing a core task, or exposes a security vulnerability |
| High     | Significantly degrades usability or accessibility for a notable subset of users |
| Medium   | Noticeable quality or performance gap; workarounds exist |
| Low      | Minor polish; low impact |
| Info     | Informational; no action strictly required |

---

## Finding catalogue

### W1 — Missing alt text on images
- **Severity:** Critical
- **Category:** Accessibility
- **Remediation:** Add descriptive `alt` attributes to all non-decorative image elements.

### W2 — Insufficient colour contrast
- **Severity:** High
- **Category:** Accessibility
- **Remediation:** Ensure text/background contrast ratio meets WCAG 2.2 AA minimum of 4.5:1.

### W3 — Form inputs missing associated labels
- **Severity:** High
- **Category:** Accessibility
- **Remediation:** Link every input to a label element via `htmlFor`/`id` or `aria-label`.

### W4 — Missing CSRF protection on state-changing APIs
- **Severity:** Critical
- **Category:** Security
- **Remediation:** Implement `SameSite=Strict` cookies and double-submit token pattern for POST/PUT/DELETE routes.

### W5 — Loading skeleton missing on async pages
- **Severity:** Medium
- **Category:** UX
- **Remediation:** Add Next.js `loading.tsx` siblings or `isLoading` guard with skeleton placeholders to prevent content flash.

### W6 — Index-based React list keys
- **Severity:** Medium
- **Category:** Performance
- **Remediation:** Replace index-based React keys with stable unique identifiers (`id`, `slug`, or composite) to prevent reconciliation bugs.

### W7 — Unthrottled search inputs triggering excessive API calls
- **Severity:** Low
- **Category:** Performance
- **Remediation:** Debounce search `onChange` handlers with a 250-350 ms delay before issuing fetch requests.

### I1 — No focus-visible ring on interactive elements
- **Severity:** Medium
- **Category:** Accessibility
- **Remediation:** Apply `:focus-visible` outline styles conforming to WCAG 2.4.11 (min 2px offset, non-colour-only).

---

*Last updated: auto-generated from the platform review catalogue. To add or amend a finding type,
update `apps/web/src/messages/en.json` (library namespace) and this file together, then open a PR.*
