# Design Document

## Overview

This design turns the 16 requirements of the zero-training UX uplift into concrete, codebase-grounded mechanisms for the CivitasOne Next.js web app (`apps/web`). It deliberately builds on primitives that already exist — `HelpTip`, `glossary.ts` (`explain()`), `helpContent.ts` (`HELP_MODULES`), the `/help` hub and `/help/[module]` guides, `FirstRunTour`, `DataTable` guided-empty props, the `PageHeader`/`ModuleHub`/`PageShell` `help` prop, and the card-list `/setup` page — and extends them into a complete, verifiable layer.

The design is organised around six capability areas that map to the requirements:

1. **Plain-language layer** — labels, subtitles, jargon replacement, and in-place term explanation (R1, R2, R12, R14).
2. **Glossary + coverage tooling** — complete the term set and detect missing coverage without breaking the clerk's view (R2).
3. **Module help system** — a guide for every Major Module including standalone Payroll and Establishment, reachable from every enabled module, tenant-scoped (R3, R4, R13).
4. **Human error system** — one error vocabulary: no transport detail, always actionable and recoverable (R5, R6).
5. **Bootstrap Wizard** — an ordered, resumable, honest, failure-tolerant org setup that captures or guides into real data entry (R7, R8, R9, R10, R13).
6. **Exploration aids** — sample-data ("try it") toggle and the first-run tour (R15, R16), with accessibility applied across all new UI (R11).

### Design Principles

- **Single source of truth for words.** Every clerk-facing definition resolves through `glossary.ts`; help content and tooltips never restate definitions inline. (R12.1, R1.5, R2.2)
- **Honest state only.** Progress and completion are computed from real tenant data; "unknown" is a first-class state, never silently rendered as done or to-do. (R8, R9.4, R10.3)
- **Degrade, never dead-end.** Every failure path keeps retry / go back / open help reachable. (R6.3, R10.4)
- **Tenant-scoped by construction.** Help, glossary surfacing, wizard steps, and sample data are filtered by the tenant's enabled modules and confined to the tenant. (R13, R15.7)
- **Reuse, don't fork.** Extend existing components with optional props rather than adding parallel implementations.

## Architecture

### Layered view

```
┌──────────────────────────────────────────────────────────────────────┐
│ Screens (module homes, lists, forms, wizard, help, dashboard)          │
│  • PageHeader(help=…) • DataTable(empty*) • EmptyState • HelpTip        │
│  • ErrorState / error.tsx • SampleDataBanner • FirstRunTour             │
└───────────────┬───────────────────────────┬──────────────────────────┘
                │                            │
   ┌────────────▼───────────┐   ┌────────────▼────────────────┐
   │ Plain-language layer    │   │ Help system                  │
   │  glossary.ts (explain)  │   │  helpContent.ts (HELP_MODULES)│
   │  labels.ts (standard)   │   │  /help, /help/[module]        │
   │  messages.ts (errors)   │   │  moduleVisibility (tenant)    │
   └────────────┬───────────┘   └────────────┬────────────────┘
                │                            │
   ┌────────────▼────────────────────────────▼────────────────┐
   │ Setup/Bootstrap layer                                       │
   │  setupSteps.ts (ordered step model + completion conditions) │
   │  setup loaders (org, locations, depts, users, modules, FY,  │
   │                 CoA, leave policies, pay structure)         │
   │  sample-data client (add / clear, tenant-scoped)            │
   └────────────┬───────────────────────────────────────────────┘
                │  gateway proxy (/api/proxy/v1/…)
   ┌────────────▼───────────────────────────────────────────────┐
   │ Backend services (existing): tenant, identity, location,    │
   │  finance, hrms, payroll, install-service orchestrator       │
   └─────────────────────────────────────────────────────────────┘
```

### Key decisions

- **AD-1 — Content-driven, not screen-by-screen.** Help, labels, and term coverage live in typed data modules (`helpContent.ts`, `glossary.ts`, `labels.ts`). Screens consume them. This makes per-module coverage testable from data rather than by crawling pages, satisfying the "explicit per-module verifiable coverage" intent of R3/R4.
- **AD-2 — Wizard is a view over real data, with an optional orchestrator.** The clerk-facing `/setup` wizard derives each step's completion from live tenant data via read loaders (the honest-progress requirement, R8). Where the `install-service` orchestrator (already built under `saas-platform-review`) is available, the wizard reflects its step/execution records; where it is not, the wizard still works by reading domain data directly. This keeps R8/R9 satisfied without a hard dependency.
- **AD-3 — One error vocabulary.** A small `messages.ts` + `ErrorState` component and a standard `error.tsx` template replace ad-hoc strings and the `DataSourceBadge` literals. All transport detail is stripped at this boundary. (R5, R6)
- **AD-4 — Tenant gating in one place.** A single `getEnabledModules()`/`isModuleEnabled()` helper drives sidebar, help listings, glossary surfacing, and wizard module steps, so multi-tenant safety is consistent. (R13)

## Components and Interfaces

### 1. Plain-language layer

#### 1.1 Glossary (`apps/web/src/lib/glossary.ts`) — extend
Add the mandated terms missing today so R2.1 is fully covered: **PPO, DDO, DBT, ESI, PT, IRN, UTR, NEFT, RTGS, BE, RE, CPC, MOM, KRA, DAK** (DBT/eOffice partially present; ensure all 15 from R2.1 resolve). Keep one plain sentence each (R2.4). `explain()` stays case-insensitive and returns `undefined` on miss (used by coverage tooling, not shown to clerks).

```ts
// New helper for coverage detection (R2.3) — never throws, never shown raw.
export function hasDefinition(term: string): boolean { return explain(term) !== undefined; }
```

#### 1.2 Standard labels (`apps/web/src/lib/labels.ts`) — new
A single map of standardised clerk-facing labels and a guard list of banned jargon, so the same concept reads the same everywhere (R12.2, R14.7).

```ts
export const LABELS = {
  tenant: "office",                 // R14.1
  sendForApproval: "Send for approval", // R14.2
  moduleToggleOn: "Turn on",        // R14.3
  moduleToggleOff: "Turn off",
} as const;

// Terms that must never appear in clerk-facing copy (checked by a unit test, R14.4/R14.6).
export const BANNED_CLERK_TERMS = [
  "tenant", "enablement", "maker-checker", "outbox", "dead-letter", "dlq",
  "idempotent", "cqrs", "API unavailable", "Live API", "read-only list loaded",
];
```

#### 1.3 HelpTip (`_components/ds/HelpTip.tsx`) — reuse, apply broadly
Already accessible (button trigger, `role="tooltip"`, `aria-describedby`, Escape/outside-close). Design rule: wherever a Major-Module primary screen renders a specialist term in a label/heading/tile/table header, wrap it with `<HelpTip term={t}>{explain(t)}</HelpTip>` (R1.2, R1.3). A thin convenience wrapper resolves the glossary automatically:

```tsx
// <Term name="GRN" />  → renders the word + a HelpTip sourced from the glossary.
export function Term({ name }: { name: string }) { /* uses explain(name) */ }
```

#### 1.4 Screen subtitles
Every Major-Module primary screen passes a one-line, jargon-free `subtitle` to `PageHeader`/`PageShell`/`ModuleHub` (R1.1, R4.6). Developer phrasing (e.g. "Read-only list loaded from the … API") is replaced (R14.6).

### 2. Module help system

#### 2.1 Help content (`apps/web/src/lib/helpContent.ts`) — extend to 9 Major Modules
Today `HELP_MODULES` has 7 entries and folds Payroll inside HR. Changes:

- **Split Payroll into its own guide** (`slug: "payroll"`, R3.4) with its own tasks (run payroll, view salary slip, GPF/NPS, pay matrix) and terms (GPF, NPS, LOP, Gratuity, Pay matrix, CPC, ESI, PT, PPO, DDO).
- **Add Establishment** (`slug: "estab"`, R3.6) with tasks (move a file/note, record DAK, minute a meeting, book a vehicle/guesthouse) and terms (eOffice, Note sheet, Dak, MOM).
- **Re-scope HR** to people/attendance/leave/appraisal (APAR, KRA, TA-DA, Deputation, Regularisation), pointing to Payroll guide for salary topics.
- Each Major Module guide MUST carry `summary`, non-empty `tasks` ("How do I…"), and `terms` ("words explained") (R3.7, R4.1, R4.4).

```ts
export type HelpModule = {
  slug: string; icon: string; title: string; summary: string; href: string;
  tasks: HelpTask[]; terms: string[];
  /** Module key used for tenant enablement gating; null = always available. */
  moduleKey: string | null;   // NEW (R13.2)
  /** True for the nine Major Modules that require full verifiable coverage. */
  major: boolean;             // NEW (R3.3)
};
export const MAJOR_MODULE_SLUGS = ["hr","payroll","finance","procurement","estab","grants","projects","citizen","tenant-admin"] as const;
```

#### 2.2 Help routes
- `/help` hub lists guides; for the clerk it lists **enabled** modules only (R13.2), but Major-Module guides remain reachable by direct URL and `generateStaticParams` so they always exist (R3.3). The hub keeps the glossary and the replay-tour button.
- `/help/[module]` renders summary + "How do I…" + "words explained" (filtered to defined terms). Unknown slug → `notFound()`.

#### 2.3 Tenant visibility (`apps/web/src/lib/moduleVisibility.ts`) — new
One helper used by sidebar, help hub, and wizard:

```ts
export async function getEnabledModules(): Promise<string[]>; // from tenant settings loader
export function isModuleEnabled(enabled: string[] | null, key: string | null): boolean; // null key => always
```

When enabled-module data is unavailable, default to showing all (backwards-compatible, matches current Sidebar behaviour) — never hide help due to a load error.

#### 2.4 "How this works" entry points
`PageHeader`/`ModuleHub`/`PageShell` already accept `help`. Design rule: every enabled Major-Module home sets `help={slug}` (R3.2, R3.6). Establishment (module-hub layout) included.

### 3. Human error system

#### 3.1 Message helpers (`apps/web/src/lib/messages.ts`) — new
Turns any failure into a `{ what, next, actions }` shape with no transport detail (R5.1, R6.1, R6.2).

```ts
export type SafeAction = "retry" | "back" | "help";
export type HumanError = { what: string; next: string; actions: SafeAction[] };

export function toHumanError(kind:
  | "load" | "save" | "offline" | "unknownStatus" | "accepted", ctx?: { area?: string }): HumanError;
```

Standard copy, e.g. `load` → what: "We couldn't load this information.", next: "Check your connection and try again.", actions: ["retry","back","help"]. `accepted` (HTTP 202 today) → "Your request was received and is being processed. It will appear shortly." (R6.5). `offline` → degraded-state copy + what they can still do (R6.4).

#### 3.2 `ErrorState` component (`_components/ds/ErrorState.tsx`) — new
Renders a `HumanError` with buttons wired to retry/back/help. Used by list pages and wizard. Replaces inline "Couldn't load…" blocks.

#### 3.3 Replace `DataSourceBadge` literals (R5.2)
`DataSourceBadge` currently renders "API unavailable"/"Live API". Re-copy to clerk-safe wording: error → "Showing saved information" (paired with guidance), healthy → render nothing (the clerk doesn't need to be told the API is live). The internal `source` prop stays for logic; only the displayed text changes.

#### 3.4 `error.tsx` template (R5.3)
Standardise the route error boundary: title + plain `what`/`next`, "Try again" (reset) and "Back" actions, and the digest shown only with a plain label — "If you contact support, quote this code:" — instead of a bare "Reference:". Apply the template wherever `error.tsx` exists.

### 4. Bootstrap Wizard

#### 4.1 Step model (`apps/web/src/lib/setupSteps.ts`) — new
A typed, ordered list of steps with a data-derived completion condition. This is the heart of honest progress (R8) and resumability (R9).

```ts
export type WizardStepKey =
  | "org-profile" | "branches" | "departments" | "people"
  | "modules" | "finance-year-coa" | "leave-policies" | "pay-structure";

export type StepStatus = "complete" | "todo" | "unknown"; // R8.4 / R10.3

export type WizardStep = {
  key: WizardStepKey; num: number; icon: string;
  title: string;          // plain (R7.2)
  explanation: string;    // plain purpose (R7.2)
  example: string;        // concrete valid input (R7.2, R7.8)
  required: boolean;      // false => skip/do-later offered (R7.5)
  /** Slug for focused guided entry; wizard returns here afterwards (R7.3). */
  entryHref: string;
  /** Module key when the step is module-dependent (R13.3). */
  moduleKey?: string;
};
```

Coverage of areas in R7.4: org-profile, branches (office hierarchy), departments, people (roles & people), modules, finance-year-coa, leave-policies, pay-structure. Module-dependent steps (finance-year-coa, leave-policies, pay-structure) are shown only when their module is enabled (R13.3).

#### 4.2 Completion evaluation (`apps/web/src/app/(app)/setup/progress.ts`) — new
For each step, a small async evaluator reads real tenant data and returns `StepStatus`:

| Step | Complete when | Source |
| --- | --- | --- |
| org-profile | tenant profile has name + address | tenant settings loader |
| branches | ≥1 location exists | locations loader |
| departments | ≥1 department exists | hrms/dept loader |
| people | >1 user exists | tenant users loader |
| modules | ≥1 module enabled | tenant settings loader |
| finance-year-coa | active FY set AND ≥1 account | finance loader |
| leave-policies | ≥1 leave policy | hrms loader |
| pay-structure | ≥1 pay component/structure | payroll loader |

Rules:
- A loader **error** for a step yields `"unknown"`, surfaced as "We couldn't check this step" — never silently `"todo"` or `"complete"` (R8.4, R10.3, R8.1).
- The Progress Indicator counts only `"complete"` steps (R8.2) and reflects every step including org-profile and departments (R8.5, fixing today's `measurable:false` shortcut).
- If the whole progress computation throws, render the last good value and keep operating (R8.3) via a cached snapshot in component state / `sessionStorage`.

#### 4.3 Wizard UI (`/setup`) — rework the existing page
- Ordered steps with plain title, explanation, example beside the input/CTA (R7.1, R7.2, R7.8).
- Each step's primary CTA either opens an **embedded guided entry** (preferred for org-profile, branches, departments) or routes to a **focused guided entry screen** that returns to `/setup` via `?return=/setup` (R7.3) — not a bare link to an unrelated hub.
- Per-step status pill: Done / To do / **Couldn't check** (R8.4).
- Skip/"Do it later" on non-required steps (R7.5); Next advances (R6→R7 ordering) (R7.6).
- Final readiness step appears when all **required** steps are `complete`, confirming readiness and offering a next destination (R7.7).
- Resumability: on load, evaluate statuses from data and focus the first non-complete step (R9.2); completed steps remain re-enterable (R9.3); status always re-derived from data, never from "visited" (R9.4).

#### 4.4 Failure handling in wizard (R10)
- Step load failure → `ErrorState` with retry, other steps still reachable (R10.1, R10.4).
- Step save failure → plain "not saved" message, step NOT marked complete, retry offered (R10.2).

#### 4.5 Optional orchestrator binding
Where `install-service` orchestrator endpoints respond, the wizard may read `GET /v1/install/wizards/:id/progress` to corroborate status, but the **authoritative** completion signal remains real domain data so honesty holds even if the orchestrator is absent or stale.

### 5. Exploration aids

#### 5.1 Sample-data toggle (R15)
- **Client:** `apps/web/src/app/(app)/setup/SampleDataControls.tsx` — "Add example records" / "Clear example records" with a `ConfirmDialog` before clearing that states exactly what will be removed (R15.5).
- **Marking:** sample records are created with a `sample: true` marker (e.g. tag/flag on the record or a dedicated sample batch id) so every list can show a "Sample" `StatusPill`/badge (R15.2).
- **Add/Clear:** call tenant-scoped endpoints (reuse the existing dev seed path where available, e.g. a `POST /v1/admin/sample-data` add and `DELETE /v1/admin/sample-data` clear) that operate only within the caller's tenant (R15.1, R15.7). Clear removes only `sample:true` records, retaining clerk-created real data (R15.3, R15.4).
- **Failure:** clear failure → plain "example records were not removed" + retry (R15.6).

#### 5.2 First-run tour (R16) — reuse + extend
`FirstRunTour` already: shows once (localStorage), skippable, keyboard/focus/Escape, explains menu/setup/help. Add:
- Ensure content explicitly names where modules are, how to begin setup, and how to reach help (R16.2) — present.
- Replay from help area already exists (`ReplayTourButton`) (R16.5).
- Harden focus management to a focus trap within the dialog while open (R11.2) and confirm accessible name/role on all controls (R16.6).

### 6. Accessibility (R11) — applies to all the above
- All new controls reachable and operable by keyboard (R11.1).
- Dialog/step panels trap focus while open and restore focus on close (R11.2).
- HelpTip, How-This-Works link, wizard step controls, sample-data controls expose accessible names/roles (R11.3).
- New UI meets WCAG 2.2 AA: 24px+ targets, visible focus, contrast, `aria-live` for status/errors (R11.4). (Full AA conformance requires manual AT testing and expert review; automated checks cover the mechanical subset.)

## Data Models

These are front-end content/state models; no new backend schema is required for the help/label/error/tour work. Sample-data and wizard completion read existing domain data.

```ts
// helpContent.ts
type HelpTask = { title: string; steps: string[] };
type HelpModule = { slug; icon; title; summary; href; tasks; terms; moduleKey; major };

// setupSteps.ts
type WizardStep = { key; num; icon; title; explanation; example; required; entryHref; moduleKey? };
type StepStatus = "complete" | "todo" | "unknown";

// messages.ts
type HumanError = { what: string; next: string; actions: ("retry"|"back"|"help")[] };

// glossary.ts — Record<string,string>, accessed via explain()/hasDefinition()
```

Sample-data marker (backend, if a flag is added): a boolean `is_sample` column or a `sample` tag on seeded rows, always tenant-scoped; clear targets `is_sample = true` for the caller's tenant only.

## Error Handling

| Situation | Behaviour | Requirement |
| --- | --- | --- |
| List/page load fails | `ErrorState` (load): plain what/next + Retry, Back, Help | R5.1, R6.1–6.3 |
| Data source unavailable badge | "Showing saved information" (no "API unavailable") | R5.2 |
| Support reference needed | Shown with plain label "quote this code" | R5.3 |
| Offline/degraded | Banner: plain state + what you can still do | R6.4 |
| Action queued (202) | "Received and being processed…" | R6.5 |
| Wizard step load fails | `ErrorState`; other steps reachable | R10.1, R10.4 |
| Wizard step save fails | "Not saved"; step not completed; retry | R10.2 |
| Step status indeterminable | Pill "Couldn't check"; not counted complete | R8.4, R10.3 |
| Progress computation throws | Show last good value; keep operating | R8.3 |
| Clear sample data fails | "Example records were not removed"; retry | R15.6 |

Internal process names shown to clerks are mapped to plain language; raw status codes/stack traces/server text are stripped at `messages.ts`/`ErrorState` (R5.1, R5.4).

## Testing Strategy

Content and logic are designed to be testable without crawling rendered pages.

### Unit tests
- **Glossary coverage (R2.1):** assert `hasDefinition()` is true for all 15 mandated terms.
- **Major-module help coverage (R3.3, R3.4, R3.6, R3.7, R4.4):** for each of the 9 `MAJOR_MODULE_SLUGS`, assert a `HelpModule` exists, is `major`, has non-empty `summary`, `tasks`, and `terms`; assert a standalone `payroll` slug exists and `estab` exists.
- **Term consistency (R1.5, R12.1/.2):** every `terms[]` entry across modules resolves via `explain()` to a single definition.
- **Banned jargon (R14.4, R14.6, R5.2):** assert help `summary`/`tasks` strings and `DataSourceBadge`/`ErrorState` copy contain no `BANNED_CLERK_TERMS`.
- **Labels (R14.1–14.3, R14.7):** `LABELS` map used; "Tenant"→"office", approval action label, module on/off label.
- **Messages (R5, R6):** `toHumanError()` outputs include non-empty `what`+`next` and ≥1 safe action; no digits-only status codes in copy.
- **Wizard step model (R7.4):** all eight areas present and ordered; required/optional flags set; module-dependent steps carry `moduleKey`.
- **Progress evaluation (R8):** with mocked loaders — complete when condition met; `"unknown"` on loader error; progress counts only complete; org-profile and departments are measurable.
- **Tenant gating (R13):** `isModuleEnabled` hides disabled modules; null enabled-list shows all.

### Integration / component tests
- Help hub lists only enabled modules for a tenant but Major-Module guide URLs still resolve (R3.3, R13.2).
- `/setup` resumes at first non-complete step and re-derives status from data (R9.2, R9.4).
- Wizard step save failure does not mark complete and shows retry (R10.2).
- Sample-data clear confirms first, removes only sample rows, keeps real rows (R15.3–15.5).

### Accessibility checks (R11)
- Keyboard-only traversal of HelpTip, help links, wizard steps, sample-data controls, and tour.
- Focus trap + restore on tour/confirm dialogs.
- Automated axe pass on `/help`, `/help/[module]`, `/setup`, dashboard tour; manual AT spot-check noted as required for full AA sign-off.

### Verification
- `pnpm --filter @civitasone/web typecheck` clean.
- `pnpm --filter @civitasone/web test` (or the app's configured runner) green for the new unit suites.
- No regression in existing build.

## Correctness Properties

These are invariants the implementation must uphold; they are the basis for the unit/integration tests above.

### Property 1: Glossary completeness
Every term in Requirement 2.1 (PPO, DDO, DBT, ESI, PT, IRN, UTR, NEFT, RTGS, BE, RE, CPC, MOM, KRA, DAK) resolves through `explain()` to a non-empty definition.
**Validates: Requirements 2.1, 2.4**

### Property 2: Single definition per term
A given term resolves to exactly one definition wherever it is surfaced; help content never restates a definition inline.
**Validates: Requirements 1.5, 12.1, 12.2**

### Property 3: Major-Module coverage
For each of the nine `MAJOR_MODULE_SLUGS`, a `HelpModule` exists with `major === true` and non-empty `summary`, `tasks`, and `terms`; `payroll` and `estab` exist as standalone slugs.
**Validates: Requirements 3.3, 3.4, 3.6, 3.7, 4.4**

### Property 4: No transport detail in clerk copy
No clerk-facing error/badge/help string contains a `BANNED_CLERK_TERMS` token, an HTTP status code, or stack/server text.
**Validates: Requirements 5.1, 5.2, 5.4, 14.4, 14.6**

### Property 5: Every error is recoverable
Every `HumanError` has non-empty `what` and `next` and at least one of retry/back/help.
**Validates: Requirements 6.1, 6.2, 6.3**

### Property 6: Honest completion
A wizard step is `complete` only when its data-derived condition holds; a loader error yields `unknown`; the Progress Indicator counts only `complete` steps and covers all eight steps.
**Validates: Requirements 8.1, 8.2, 8.4, 8.5**

### Property 7: Resumption from data
On re-entry the wizard derives each step's status from current tenant data, never from a prior-visit flag.
**Validates: Requirements 9.2, 9.4**

### Property 8: Tenant scoping
Help listings, glossary surfacing, wizard module steps, and sample-data operations are confined to enabled modules and the caller's own tenant; a missing enablement signal shows all rather than hiding due to error.
**Validates: Requirements 13.1, 13.2, 13.3, 13.4, 15.7**

### Property 9: Sample-data safety
Clearing sample data removes only records marked sample and retains clerk-created real records, after an explicit confirm.
**Validates: Requirements 15.3, 15.4, 15.5**

### Property 10: Accessibility floor
All new interactive controls are keyboard-operable with managed focus and accessible names/roles.
**Validates: Requirements 11.1, 11.2, 11.3**
