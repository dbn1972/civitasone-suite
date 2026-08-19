# GIGW 3.0 Compliance Checklist — CivitasOne Suite

**Sprint 24, Task 38 (Req 7.5).**

## Scope note — GIGW 3.0's actual structure

The task description references "Section 2–9," but that numbering does not
match the real GIGW 3.0 document. Per the Standardisation Testing and Quality
Certification (STQC) directorate's GIGW 3.0 Transition Plan (the primary
government source for the guideline's structure), GIGW 3.0 — *"Guidelines for
Indian Government Websites and Apps"* — is organized into **four sections**:

| GIGW 3.0 Section | Attribute count |
|---|---|
| 5.1 Quality | 25 |
| 5.2 Accessibility | 50 |
| 5.3 Cybersecurity | 3 |
| 5.4 Lifecycle management | 10 |

This checklist maps each section to CivitasOne's implementing file path (or a
documented waiver), matching what the task actually asks for — traceability
between a real guideline area and the code that satisfies it — using the
correct four-section structure instead of the non-existent numbering the task
named.

Full certification against GIGW 3.0 requires a formal audit by STQC or an
authorized agency; this checklist is an internal self-assessment to guide that
audit, not a substitute for it.

---

## 5.1 Quality

| Area | Status | Implementing file / evidence |
|---|---|---|
| Bilingual content (Hindi + English) | ✅ Implemented | `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json` (next-intl) |
| Consistent navigation, breadcrumbs, page headers | ✅ Implemented | `apps/web/src/app/_components/ds/PageHeader.tsx`; every module layout under `apps/web/src/app/(app)/*/layout.tsx` |
| Search / filter on data-heavy screens | ✅ Implemented | `DataTable` `filterable` prop, used across all 347 list screens (`apps/web/src/app/_components/ds/DataTable.tsx`) |
| No dead links / dead controls | ✅ Implemented | CI-enforced via `pnpm verify-screens` (`scripts/contract/verify-screens.mjs`) and the screen-map contract test (`tests/contract/screens.contract.test.ts`) |
| Content currency / no stale placeholder data | ✅ Implemented | Architecture rule: every screen must be API-backed, no `const rows = [...]` mocks (enforced by the screen contract gate) |
| Responsive layout (desktop + tablet) | ✅ Implemented | `structure.md` steering rule: "all pages must work at 1024px+ width. Dashboard and list views must be usable at 768px" |
| Feedback / help mechanism | ⚠️ Partial | `HelpTip` component exists (`apps/web/src/app/_components/ds/HelpTip.tsx`) and `PageHeader` accepts a `help` slug, but coverage across all 347 screens is not itself gated in CI — no automated check that every page has a help link |
| Error pages (404 / 500) | ✅ Implemented | Per-module `not-found.tsx` / `error.tsx` (e.g. `apps/web/src/app/(app)/estab/not-found.tsx`), React error boundaries per steering rule |
| Print-friendly views for statutory documents | ✅ Implemented | e.g. GRN note-sheet PDF export (`/api/proxy/v1/estab/files/:id/note-sheet/pdf`), `@civitasone/render` package for PDF generation + DSC signing |

## 5.2 Accessibility

GIGW 3.0's accessibility section (50 attributes) is built on WCAG 2.2 AA,
which is the standard this codebase targets directly (`product.md` steering:
*"GIGW 3.0 | Partial | Bilingual (Hindi/English), accessibility in
progress"*). Evidence below is organized by WCAG principle rather than
attribute number, since GIGW 3.0 does not publish stable attribute IDs in any
source accessible to this audit.

| Area | Status | Implementing file / evidence |
|---|---|---|
| Skip-to-main-content link | ✅ Implemented | `apps/web/src/app/(app)/estab/layout.tsx`, `inventory/layout.tsx`, `procurement/layout.tsx` (task 12, PR #652) |
| Keyboard-operable interactive elements (tables, dialogs) | ✅ Implemented | `DataTable` row `tabIndex`/`onKeyDown` (task 14); `ConfirmDialog` dependency-free focus trap (task 21, PR #653) |
| ARIA live regions for dynamic content | ✅ Implemented | `NotificationsPanel` `aria-live="polite"` (task 15); DFA step-change `aria-live="assertive"` (task 17, PR #654); movement-type chips `role="status"` (task 19, PR #655) |
| Color contrast (WCAG 1.4.3, AA) | ✅ Implemented | `apps/web/src/lib/contrast.ts` unit-tested against the WCAG relative-luminance formula; CI gate `tests/a11y/design-tokens.test.ts` (task 13, PR #652) |
| Non-color-only status encoding | ✅ Implemented | Variance arrows (▲/▼) + sign + color together, not color alone (task 20, PR #656) |
| Alt-text / accessible names on icon-only controls | ✅ Implemented | `aria-label` audit across line-item editors (task 23, PR #658) |
| Table captions for screen-reader context | ✅ Implemented | `<caption className="sr-only">` on `AllotmentsTable` and equivalents (task 16) |
| Chart alternative data tables (non-visual access to chart data) | ✅ Implemented | sr-only `<table>` alongside inventory forecast + vendor scorecard radar charts (task 18, PR #668) |
| Required-field indication for assistive tech | ✅ Implemented | `aria-required` + `aria-describedby` wiring on GRN/allotment forms (task 22, PR #657) |
| Mobile table overflow (no horizontal clipping) | ✅ Implemented | Global `.tbl-wrap{overflow-x:auto}` in `civitas-ds.css`, verified with no gaps across estab/inventory/procurement (task 25) |
| Automated axe-core CI gate (WCAG 2.2 AA) | ✅ Implemented | `.github/workflows/ci.yml` `accessibility` job, ratcheted against `apps/web/tests/a11y/a11y-baseline.json` |
| Full manual assistive-technology testing (screen reader, switch access) | ❌ Not done | Automated axe-core coverage only. Per this project's own steering rule, "full validation requires manual testing with assistive technologies and expert accessibility review" — no manual AT pass has been recorded |
| Native mobile app accessibility (GIGW 3.0's expanded app-specific guidance) | ⚠️ Partial | Flutter semantic widgets + `flutter analyze` gate exist (`apps/mobile`), but no dedicated GIGW mobile-accessibility checklist has been run against the Flutter app specifically |

## 5.3 Cybersecurity

| Area | Status | Implementing file / evidence |
|---|---|---|
| TLS / HSTS enforced at the edge | ✅ Implemented | `@fastify/helmet` registered in `services/gateway-service/src/app.ts` (Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options) |
| Vulnerability scanning (dependency + container) | ✅ Implemented | `.github/workflows/security.yml`: `dependency-audit`, Trivy container scan (gateway/finance/hrms images), CodeQL SAST |
| DAST baseline scan | ✅ Implemented | ZAP baseline scan against the gateway in `security.yml` |
| Secret scanning | ✅ Implemented | `gitleaks-action` in `.github/workflows/security.yml`'s `secret-scan` job, plus an inline dev-secret pattern scan in `ci.yml`'s own `secret-scan` job |
| CERT-In incident reporting readiness | ⚠️ Partial | `tech.md` steering documents a 6-step incident-response process (Grafana alert → triage → mitigation → status page → resolution → post-mortem → CERT-In reporting within 6 hours), but no dedicated incident-response runbook file exists in `docs/runbooks/` yet — the process is currently steering-doc-only, not a standalone operational document |

## 5.4 Lifecycle management

| Area | Status | Implementing file / evidence |
|---|---|---|
| Content management workflow (create → approve → publish → archive) | ✅ Implemented | eOffice file noting workflow with maker-checker approval chain (`services/estab-service/src/modules/files/`) — analogous lifecycle discipline applied to the platform's own document/noting content, not to public-facing CMS pages (this platform is an internal ERP/eOffice suite, not a public content website) |
| Periodic conformity re-certification | ❌ Not done | No recurring STQC re-certification cadence documented. This checklist itself should be the seed of that process — recommend an annual review tied to each major release |
| Tamper-evident audit trail (supports lifecycle integrity) | ✅ Implemented | Hash-chained audit events (`services/audit-service/src/modules/events/domain.ts`) and hash-chained eOffice green notes (`services/estab-service/src/modules/files/domain.ts`) |
| Disaster recovery / backup lifecycle | ✅ Implemented | RPO 1hr / RTO 30min, documented in `product.md` steering; drilled quarterly via `.github/workflows/dr-drill.yml` (note: `product.md` references `docs/runbooks/dr-drill.md`, which does not exist yet — the GitHub Actions workflow is the actual implementing artifact) |
| Deprecation / versioning lifecycle for APIs | ✅ Implemented | `/v1/` → `/v2/` 90-day deprecation policy (`tech.md` steering, "API Versioning & Deprecation") |
| Centralised content-quality monitoring dashboard | ❌ Not done | GIGW 3.0 recommends a dashboard that alerts on non-conformity. No such dashboard exists for public-facing GIGW checkpoints specifically (the platform has extensive internal ops dashboards — `services/admin-service` — but none scoped to GIGW conformity) |

---

## Summary

| Section | Implemented | Partial | Not done |
|---|---|---|---|
| Quality | 8 | 1 | 0 |
| Accessibility | 10 | 2 | 0 |
| Cybersecurity | 4 | 1 | 0 |
| Lifecycle management | 3 | 0 | 2 |

**Open items requiring action before a formal STQC certification attempt:**
1. Manual assistive-technology testing pass (screen reader + switch access) — automated axe-core alone does not satisfy full WCAG 2.2 AA conformance claims.
2. Flutter mobile app accessibility review against GIGW 3.0's app-specific guidance.
3. Establish a recurring (recommended: annual) re-certification cadence.
4. Decide whether a GIGW-specific conformity dashboard is in scope, given this is an internal government ERP rather than a public content website — GIGW 3.0 was written primarily for public-facing sites/apps, and several Quality/Lifecycle checkpoints (public content publishing workflow, citizen-facing search) map imperfectly onto an internal back-office suite. This scope question should be resolved with the client agency before further GIGW work, since it changes which checkpoints are even applicable.
