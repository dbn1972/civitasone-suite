# Implementation Plan

## Overview

Tasks are ordered so shared foundations (glossary, labels, messages, help content, tenant gating) land before the screens and flows that depend on them. Each task is incremental, references the requirements it satisfies, and ends in a typecheck/test-verifiable state. No task includes deployment or manual-only work. All work is in `apps/web` plus, where sample data needs a marker, a tenant-scoped backend endpoint.

## Tasks

- [x] 1. Complete the shared glossary and add coverage tooling
  - Add plain-language definitions for all mandated terms missing today: PPO, DDO, ESI, PT, IRN, UTR, NEFT, RTGS, BE, RE, CPC, MOM, KRA (and confirm DBT, DAK, eOffice resolve)
  - Add `hasDefinition(term)` helper that never throws and is safe for coverage checks
  - Write unit tests asserting every term in Requirement 2.1 resolves and every definition is non-empty
  - _Requirements: 2.1, 2.3, 2.4_

- [x] 2. Add the standardised label map and banned-jargon guard
  - Create `apps/web/src/lib/labels.ts` with `LABELS` (office, Send for approval, Turn on/off) and `BANNED_CLERK_TERMS`
  - Write a unit test that scans help content + error/badge copy for banned terms
  - _Requirements: 12.2, 14.1, 14.2, 14.3, 14.4, 14.6, 14.7_

- [x] 3. Build the human-error vocabulary and components
- [x] 3.1 Create `apps/web/src/lib/messages.ts` with `toHumanError(kind, ctx)` covering load, save, offline, unknownStatus, and accepted, each returning plain `what` + `next` + safe actions
  - Unit-test that output has non-empty what/next, at least one safe action, and contains no raw status codes or transport phrasing
  - _Requirements: 5.1, 5.4, 6.1, 6.2, 6.3, 6.5_
- [x] 3.2 Create `ErrorState` component rendering a `HumanError` with retry/back/help actions wired
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
- [x] 3.3 Re-copy `DataSourceBadge` to clerk-safe wording (remove "API unavailable"/"Live API"; show "Showing saved information" on error, nothing when healthy)
  - _Requirements: 5.2_
- [x] 3.4 Standardise the route `error.tsx` template (plain what/next, Try again + Back, digest shown only with a plain "quote this code" label) and apply to existing error boundaries
  - _Requirements: 5.1, 5.3, 6.3_
- [x] 3.5 Add an offline/degraded banner and a "received and being processed" message path for queued (202) actions, using `messages.ts`
  - _Requirements: 6.4, 6.5_

- [x] 4. Expand module help content to all nine Major Modules
- [x] 4.1 Extend `HelpModule` type with `moduleKey` and `major`, and add `MAJOR_MODULE_SLUGS`
  - _Requirements: 3.3, 13.2_
- [x] 4.2 Split Payroll into a standalone guide (`payroll`) with its own tasks and terms (GPF, NPS, LOP, Gratuity, Pay matrix, CPC, ESI, PT, PPO, DDO); re-scope the HR guide to people/leave/attendance/appraisal
  - _Requirements: 3.4, 3.7, 4.1, 4.4_
- [x] 4.3 Add the Establishment guide (`estab`) with tasks (file/note, DAK, MOM, vehicle/guesthouse) and terms (eOffice, Note sheet, Dak, MOM)
  - _Requirements: 3.6, 3.7, 4.1, 4.4_
- [x] 4.4 Ensure every Major-Module guide has non-empty summary, tasks, and terms; write a coverage unit test over `MAJOR_MODULE_SLUGS`
  - _Requirements: 3.3, 3.7, 4.4, 1.5, 12.1, 12.2_

- [x] 5. Add tenant module-visibility helper and apply it to help
- [x] 5.1 Create `apps/web/src/lib/moduleVisibility.ts` (`getEnabledModules`, `isModuleEnabled`) defaulting to "show all" when enablement data is unavailable
  - Unit-test gating (disabled hidden, null-list shows all)
  - _Requirements: 13.1, 13.2, 13.4_
- [x] 5.2 Filter the `/help` hub to enabled modules for the clerk while keeping Major-Module guide URLs resolvable via `generateStaticParams`
  - _Requirements: 3.3, 13.1, 13.2_

- [x] 6. Apply the plain-language layer across Major-Module primary screens
- [x] 6.1 Add the `Term` convenience wrapper (word + glossary-sourced HelpTip) in the design system
  - _Requirements: 1.2, 1.3, 1.5_
- [x] 6.2 Set a plain one-line subtitle and `help={slug}` on every Major-Module home and primary screen (HRMS, Finance, Procurement, Establishment, Payroll, Grants, Projects, Citizen, Office Admin), replacing any developer phrasing
  - _Requirements: 1.1, 3.2, 3.6, 4.6, 14.6_
- [x] 6.3 Wrap specialist terms in labels/headings/tile/table headers on those screens with `Term`/`HelpTip`
  - _Requirements: 1.2, 1.3, 1.4, 14.5_
- [x] 6.4 Apply standardised labels (office, Send for approval, Turn on/off) on the affected screens
  - _Requirements: 14.1, 14.2, 14.3, 14.7_

- [x] 7. Ensure guided empty states on Major-Module list screens
  - Pass `emptyIcon/emptyTitle/emptyMessage/emptyAction` (or `EmptyState` with action) on the main list pages of each Major Module, with a plain purpose line and a next action
  - Confirm the fallback basic empty message path when no guided content is provided
  - _Requirements: 4.2, 4.3, 4.5_

- [x] 8. Build the Bootstrap Wizard step model and honest progress
- [x] 8.1 Create `setupSteps.ts` with the eight ordered steps (org-profile, branches, departments, people, modules, finance-year-coa, leave-policies, pay-structure), each with plain title/explanation/example, required flag, entryHref, and moduleKey where module-dependent
  - _Requirements: 7.1, 7.2, 7.4, 7.8, 13.3_
- [x] 8.2 Create `progress.ts` with per-step completion evaluators reading real tenant data, returning complete/todo/unknown
  - Unit-test: complete only when condition met; loader error → unknown; org-profile and departments measurable
  - _Requirements: 8.1, 8.4, 8.5, 9.4_
- [x] 8.3 Compute the Progress Indicator from completed steps only, with last-good-value fallback if computation throws
  - _Requirements: 8.2, 8.3_

- [x] 9. Rework the `/setup` wizard UI
- [x] 9.1 Render ordered steps with plain title/explanation/example and per-step status pill including a "Couldn't check" state
  - _Requirements: 7.1, 7.2, 7.8, 8.4_
- [x] 9.2 Make each step capture data inline or route to a focused guided entry screen that returns to `/setup` (via `?return=/setup`), not a bare hub link; offer skip/do-later on non-required steps and Next to advance
  - _Requirements: 7.3, 7.5, 7.6_
- [x] 9.3 Add resumability: on load, derive statuses from data and focus the first non-complete step; allow re-entry of completed steps; never mark complete from a prior visit
  - _Requirements: 9.1, 9.2, 9.3, 9.4_
- [x] 9.4 Add the readiness/finish state shown when all required steps are complete, with a next destination
  - _Requirements: 7.7_
- [x] 9.5 Add wizard failure handling: load failure → ErrorState with retry while other steps stay reachable; save failure → "not saved" + step stays incomplete + retry
  - _Requirements: 10.1, 10.2, 10.3, 10.4_
- [x] 9.6 Scope module-dependent steps to enabled modules using `moduleVisibility`
  - _Requirements: 13.3_

- [x] 10. Sample-data ("try it") toggle
- [x] 10.1 Add `SampleDataControls` (Add example records / Clear example records) on `/setup`, with a ConfirmDialog before clearing that states exactly what will be removed
  - _Requirements: 15.1, 15.5_
- [x] 10.2 Wire add/clear to tenant-scoped endpoints; mark sample records so lists can show a "Sample" badge; clear removes only sample records and keeps real ones
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.7_
- [x] 10.3 Handle clear failure with a plain "not removed" message and retry
  - _Requirements: 15.6_

- [x] 11. First-run tour hardening
  - Confirm tour content names module location, how to begin setup, and how to reach help; verify show-once + replay-from-help
  - Add a focus trap within the dialog and restore focus on close; confirm accessible names/roles on controls
  - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_

- [x] 12. Accessibility pass on all new UI
  - Verify keyboard-only operation, focus management, accessible names/roles, 24px targets, visible focus, and aria-live for status/errors on HelpTip, help pages, wizard, sample-data controls, and tour
  - Run automated axe checks on `/help`, `/help/[module]`, `/setup`, and the dashboard tour
  - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 13. Final verification
  - Run `pnpm --filter @civitasone/web typecheck` and the web unit/component test suites; fix any failures
  - Run the banned-jargon and Major-Module coverage tests as the regression gate
  - _Requirements: 2.1, 3.3, 3.4, 3.6, 5.2, 14.4_

## Task Dependency Graph

```
1 (glossary) ─┬─> 4 (help content) ─┬─> 5 (tenant visibility) ─> 6 (plain-language screens)
              │                      └─> 9 (wizard UI: help links)
              └─> 6.1/6.3 (Term + tooltips)

2 (labels) ───> 6.4 (standard labels on screens)

3 (messages/ErrorState) ─┬─> 7 (guided empty states)
                         ├─> 9.5 (wizard failure handling)
                         └─> 10.3 (sample-data failure)

8 (step model + progress) ─> 9 (wizard UI) ─> 10 (sample data on /setup)

11 (tour) and 12 (a11y pass) depend on the UI from 6, 9, 10 existing.

13 (final verification) depends on all prior tasks.
```

Critical path: 1 → 4 → 5 → 6 → (8 → 9) → 10 → 11 → 12 → 13. Tasks 2 and 3 can proceed in parallel with 1/4 and feed 6, 7, 9, and 10.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2", "3"], "rationale": "Independent foundations: glossary, labels, error vocabulary." },
    { "wave": 2, "tasks": ["4", "8"], "rationale": "Help content and wizard step/progress model build on the glossary." },
    { "wave": 3, "tasks": ["5", "9"], "rationale": "Tenant visibility and wizard UI depend on help content and the step model." },
    { "wave": 4, "tasks": ["6", "7", "10"], "rationale": "Screen-level plain-language, guided empty states, and sample data depend on the layers above." },
    { "wave": 5, "tasks": ["11", "12"], "rationale": "Tour hardening and the accessibility pass require the new UI to exist." },
    { "wave": 6, "tasks": ["13"], "rationale": "Final verification gate over all prior work." }
  ]
}
```

## Notes

- Reuse existing primitives (`HelpTip`, `EmptyState`, `DataTable` empty props, `PageHeader`/`ModuleHub`/`PageShell` `help` prop, `FirstRunTour`, `ConfirmDialog`); extend with optional props rather than forking components.
- Honest progress is the load-bearing rule: completion is derived from real tenant data, and "unknown" must never be rendered as done or to-do.
- The `install-service` orchestrator (from the `saas-platform-review` spec) is an optional corroborating source for wizard progress, not the authority.
- Backend changes are limited to an optional tenant-scoped sample-data add/clear and an `is_sample` marker; all other work is front-end content/components.
- Full WCAG 2.2 AA sign-off requires manual assistive-technology testing beyond the automated axe checks listed in task 12.
