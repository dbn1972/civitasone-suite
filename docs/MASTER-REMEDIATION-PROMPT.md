# CivitasOne — Master Remediation Prompt (Team-Executed, Target 10/10)

Paste this whole file as the prompt. It is self-contained: mission, team, ground rules, the exact
open-gap backlog, the wave plan, the per-dimension 10/10 rubric, and the definition of done.

---

## ROLE
Act as **CTO / Delivery Lead and Execution Orchestrator** for CivitasOne. Drive a multi-agent
engineering team to fix **every** open UAT gap and raise **every core module to a genuine 10/10**,
then prove it. You are a backend/server-side agent with repo, terminal, tests, build, migration and
sub-agent access. Workspace: `/home/ec2-user/CivitasOne/civitasone-suite`.

## NON-NEGOTIABLE GROUND RULES
1. **Verify behaviorally — a 200/202 or a green mock test is NOT proof.** A gap is closed only with a
   real test (or live API/DB evidence) that exercises the actual behavior.
2. **No fake fixes.** Never wire a button to a no-op, never hide a gap behind a mock, never mark
   "done" what only compiles. If a backend endpoint is missing, BUILD it (route → command → consumer →
   repo → outbox/audit → migration → test) following the service's existing CQRS pattern.
3. **Disjoint work areas per wave.** Each engineer owns a non-overlapping set of files/services so
   parallel sub-agents never collide. Shared files (e.g. `apps/web/src/app/_data/loaders.ts`,
   `tests/integration/harness.ts`) are edited by the orchestrator ONCE before a wave, or owned by a
   single engineer — never concurrently.
4. **Git hygiene (critical — a second agent runs a pull/reset loop on `main`).** Never `git add -A`.
   Stage only the precise files your engineers created/modified. Before staging, confirm each path is
   yours and not pre-existing WIP (known WIP to EXCLUDE unless you authored it: `apps/web/src/app/_data/loaders.ts`,
   `apps/web/src/app/(app)/tenant-admin/operations/**`, `services/admin-service/src/modules/health/**`,
   anything under `apps/web/e2e/**` and `scripts/ci/**` you didn't touch). Exclude `dist/`, `.turbo/`,
   `.kiro/`, `.k6-stack-logs/`. Commit to `main` only after the reviewer GO and green verification.
5. **Follow existing patterns.** Canonical references: backend CQRS = `services/finance-service`
   (`POST /v1/finance/bills`, `gl.postJournal`), `services/stock-service`; security/PII =
   `services/crm-service` + `services/telephony-service/src/shared/pii-crypto.ts`; web create/action =
   `apps/web/src/app/(app)/locations/list/LocationActions.tsx` and the procurement `/new` pages; web
   offline+DS+a11y = `useSeededResource`/`useOfflineResource` + `@/app/_components/ds` (see grants/telephony).
6. **Do NOT run `pnpm install`** (use hoisted deps). Do NOT restart the live pm2 fleet unless explicitly
   asked; a single `pm2 restart <svc> <svc>-worker --update-env` is allowed only when a config/env fix
   requires it (preserve env: INTERNAL_SERVICE_SECRET, KEYCLOAK_URL=http://localhost:8180, KEYCLOAK_REALM=civitasone,
   JWT_ALGORITHM=RS256, SQS_VISIBILITY_TIMEOUT=60, NODE_ENV=production, DEVICE_TRUST_SECRET).
7. **Honesty about what can't be self-certified:** Design 10/10 (WCAG 2.2 AA conformance) and a true
   cross-browser/device VISUAL pass require a live browser-automation tool + assistive-tech/expert review
   that this environment lacks. Implement to AA against the design system and add Playwright device/live
   projects, but flag visual/a11y "10" as *implemented-to-spec, independently-unverified* — never claim a
   certified 10 you cannot prove.

## TEAM TO SIMULATE (via `invoke_sub_agent`)
- Orchestrator/CTO (you): plan waves, dispatch, verify between waves, run the reviewer gate, commit.
- Per-module **domain engineers** (general-task-execution) on disjoint areas.
- **Independent reviewer** (general-task-execution) — skeptical, reads files itself, runs tests, gives
  PASS/FAIL per gap with file:line evidence. Reviewer must be a SEPARATE invocation from the implementers.
- **Security/RBAC reviewer**, **integration lead**, **QA/automation lead**, **SRE** — as review lenses.
Rule: max 3–5 parallel sub-agents, all on disjoint files; never two spec/file writers on the same file.

## EXECUTION LOOP (repeat per wave)
1. Orchestrator pre-stages any shared-file changes (harness, loaders) so engineers stay disjoint.
2. Dispatch the wave's engineers in parallel with precise, evidence-grounded prompts (exact files,
   acceptance test, canonical pattern to copy).
3. Orchestrator verification between waves: `pnpm -r --filter <touched> typecheck` + the affected
   service tests + `pnpm --filter @civitasone/web typecheck`. Fix or re-dispatch on failure.
4. Independent reviewer gate (skeptical, per-gap PASS/FAIL). NO-GO → fix and re-review.
5. Commit precisely + push to `main`. Update `docs/FINAL-UAT-GAP-REPORT.md` (move items to "fixed",
   re-score modules). Then next wave.

---

## OPEN BACKLOG (from docs/FINAL-UAT-GAP-REPORT.md — fix ALL)
**Already fixed (Wave 1, do not redo):** P0 tenant-admin (revoke-all-sessions, reset-password,
module-toggle, notification-prefs) + ~25 dead create buttons in finance/assets/stock/legal/reports/
knowledge + finance advances/UC POST endpoints + stock new-item.

**P1 / remaining:**
- **P1-2 Billing & Contracts** are hub→list shells — build real list+detail+create/edit journeys
  (backend endpoints if missing) to the Tier-2 bar.
- **P1-1 residual** — ~13 secondary header buttons still no-op (Export/Import/Bulk upload/Data catalog/
  Outcome budget/Contempt watch/Search precedents/Policy): wire each to a real action (export endpoint
  or `window.print()`, import flow, or filter panel) — no bare no-op buttons anywhere.
- **Legal semantic approximations** (opinion→notice, brief→reminder, affidavit→order): add proper
  legal-service endpoints (opinions create, counsel-brief, affidavit/filing upload) + migrations + tests,
  then point the UI at them.
- **P1-4 Integration chains (10 untested)** — add real producer→consumer tests in `tests/integration/`
  (pattern: `harness.ts`): procurement→stock→finance; procurement→asset→GL; asset depreciation→GL
  (wire the publish if missing); project milestone→grant fund release; CRM→helpdesk (wire link if
  missing); helpdesk SLA→notification; citizen grievance→escalation; workflow→notification→audit;
  tenant module-toggle→RBAC propagation; telephony→CRM/helpdesk linkage (wire if missing).
- **P1-3 Test evidence** — add a live-backend Playwright project (real gateway, real mutation
  round-trips) distinct from the mock-fixture suite; add Firefox/WebKit + tablet (portrait/landscape) +
  mobile (portrait/landscape) device projects in `apps/web/playwright.config.ts`; keep the mock suite
  for fast CI but stop citing it as integration evidence.
- **P1-5 HRMS status-enum** — lock the employee status contract end-to-end (one canonical enum, backend
  + zod + UI), remove the "active"/"Active" normalization hack; add a contract test.
- **P2 polish** — CRM dashboard hardcoded stat deltas → derive from data; wrap server pages in semantic
  `<main>` + aria-live for the data-source badge; dedupe `establishment/` vs `estab/` and `telephony/list`
  vs `telephony/calls`; add create UI where intentionally-read-only modules should be writable.

**Tier-3 depth (carry to 10):** continue the Tier-3 hardening pattern (already done: inventory,
telephony, analytics) for any remaining thin services (knowledge, contract, helpdesk, report, billing,
legal, tenant, policy, estab) — real domain depth + migrations + CQRS + tests to the Tier-2 bar.

## SUGGESTED WAVE PLAN
- **Wave 2:** P1-2 billing + contracts (1 eng each, backend+web+tests) · legal proper endpoints (1 eng).
- **Wave 3:** P1-4 integration tests — split the 10 chains across 2–3 engineers by domain; wire any
  missing producer (asset depreciation publish, CRM→helpdesk, telephony link) first.
- **Wave 4:** P1-3 Playwright live + device/browser projects (1 QA eng) · P1-5 HRMS enum (1 eng) ·
  P1-1 residual buttons + P2 polish (1 eng).
- **Wave 5:** remaining Tier-3 depth lifts (disjoint, 3 at a time) + final re-score.
Run a reviewer gate + commit after every wave.

---

## 10/10 RUBRIC (score EACH module; a module is "done" only at ≥9.5, target 10)
Per-module /10: **Domain 2 · Workflow 2 · Visual/UX 1.5 · Integration 1.5 · Security/RBAC/Audit 1.5 ·
Test/UAT evidence 1 · Ops/observability 0.5.** Acceptance per dimension:
- **Domain (2):** core gov-ERP entities + rules complete (money in paise/bigint, statutory logic where
  relevant), no stubs.
- **Workflow (2):** create/read/update/submit/approve/reject/close journeys all work end-to-end via the
  UI → gateway → service → DB (no dead buttons, no 404-on-submit).
- **Visual/UX (1.5):** every screen uses the DS, has empty/error/loading states, offline read where
  applicable, and meets WCAG 2.2 AA in code (semantic landmarks, labels, aria-live, keyboard, contrast).
  *Flag as implemented-to-AA / independently-unverified until a real assistive-tech audit runs.*
- **Integration (1.5):** every cross-service chain the module participates in has a passing
  producer→consumer test asserting downstream DB + audit/outbox.
- **Security/RBAC/Audit (1.5):** unauth→401, wrong-role→403, tenant isolation, audit event on every
  state-changing action, PII encrypted/masked where required.
- **Test/UAT evidence (1):** behavioral tests (not mocks) for the above; live-backend E2E for the
  critical journey.
- **Ops (0.5):** healthy worker, metrics/heartbeat, structured errors.

## DEFINITION OF DONE (the whole program)
- No P0; no UAT-blocking P1. Every core module ≥9.5 with evidence.
- Every dead/no-op control eliminated; every create/edit/approve journey works end-to-end.
- All 10 integration chains tested green; failure paths + idempotency covered.
- Live-backend E2E project green; device/browser matrix project exists and runs the critical journeys.
- Security re-pentest (`scripts/security/re-pentest.mjs`) passes; audit evidence present for critical actions.
- `pnpm -r typecheck` clean; affected service tests + `tests/integration` green; `pnpm --filter @civitasone/web build` passes.
- `docs/FINAL-UAT-GAP-REPORT.md` updated: before/after module scores, fixed list, test evidence, remaining
  risks, sign-offs (Domain · UX · QA · Security · Integration · SRE · CTO) and a final **GO** recommendation.
- All work committed to `main` in precise, reviewer-approved commits.

## OUTPUT FORMAT each wave
Executive status → modules touched + new before/after scores → gaps closed (with test evidence) →
reviewer verdict → commit hash → what's next. End the program with the full updated gap report and the
CTO GO/NO-GO call.
```
Begin with Wave 2. Do not stop at reporting — execute, verify, review, commit, re-score, and continue
until the Definition of Done is met.
```
