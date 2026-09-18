# COMP-008 — Mobile Parity Roadmap

**Status:** First concrete roadmap artifact for this gap. Supersedes the prose
recommendation in `docs/ENTERPRISE-GAP-REPORT-2026-09-07.md` (row COMP-008), which
described this roadmap's shape but never existed as a standalone document until now.
**Date:** 2026-09-18. **Author:** tranche-3 planning pass (no code changes this tranche).

## 0. Why this document, and why now instead of another feature tranche

Two prior tranches (PR #1383, PR #1394) each picked their next mobile feature by
re-deriving "what's actually buildable" from scratch, live, mid-tranche. Tranche 1
suggested arrears/waivers as natural next steps; tranche 2 had to discover — by
reading source — that arrears is maker-checker-only and waivers has no GET route at
all, and pivoted to Assessee directory instead. That pivot worked because tranche 2
had the time to do the legwork, but it's the same legwork every future tranche would
otherwise repeat, and the gap-report row's own text (a dense paragraph, not a table)
is not a usable substitute. With ~15 real candidate modules and ~24 formally excluded
ones still undifferentiated, the highest-value next step is writing that down once,
grounded in the actual source tree, so tranche 3 onward can start executing instead
of re-discovering.

## 1. Method — what was verified vs. inferred

- **Hard counts** (verified by direct directory listing against the exact backend
  routes/files, not by trusting previously-cited numbers): 61 web modules
  (`apps/web/src/app/(app)/*`), 35 mobile feature folders
  (`apps/mobile/lib/features/*`), of which **34 are real business features and 1
  (`sync`) is the offline-sync-engine's failure-log UI** — infrastructure, not a
  module-parity feature. That correction is why the tranche-2 count is 35 and not 34.
- **Mobile→backend mapping**: derived by grepping each feature folder for the literal
  `/v1/<segment>` paths it calls, cross-checked against actual file names inside each
  folder (not folder names alone — see the two corrections below, which is exactly why
  folder-name matching isn't trustworthy on its own in this codebase).
- **Two corrections this pass made to what a name-only read would have concluded**,
  flagged because the same trap is easy to fall into again:
  - `apps/mobile/lib/features/estab/` is **not** revenue data — it's DAK inbox /
    eFile / file-noting screens (`dak_inbox_screen.dart`, `efile_screen.dart`,
    `file_noting_screen.dart`). It maps to the web **`estab`** module's
    correspondence/e-office slice, not to `revenue`.
  - `apps/mobile/lib/features/directory/` is **Employee Directory + ID card**
    (`employee_directory_screen.dart`, `id_card_screen.dart`), not the "Assessee
    directory" tranche 2 built. Tranche 2's Assessee and Trade License screens both
    actually live under `apps/mobile/lib/features/revenue/`
    (`assessee_list_screen.dart`, `trade_license_list_screen.dart`, etc.).
- **Backend-readiness spot checks**: for the two Tier-1 recommendations below only, I
  read the actual route/schema file (not just that a service directory exists) to
  confirm a real, paginated, role-gated GET already exists. For everything in Tier 2–4
  I confirmed the **service exists** (or, for `municipal`, that no dedicated service
  exists) but did **not** re-verify route-level viability — that is exactly the
  depth of check a tranche executing that module should do first, the same way
  tranche 2 did for arrears/waivers before committing.
- Module classification (exclude / covered / gap) is grounded in each web module's
  actual directory contents (`ls` one level deep), not in its name alone — see the
  full table in §5.

## 2. Formal exclusion list — recommend removing these from the mobile parity target

24 of the 61 web modules are platform/tenant administration, security/IAM config,
low-code authoring surfaces, commercial/billing admin, or desk-bound analytics
tooling with no field-officer or citizen-facing use case. None of these belong on a
field-officer phone; building them would not move the DoD forward. Grouped by why:

| Category | Modules | Why |
|---|---|---|
| Tenant/platform admin | `admin`, `platform-admin`, `tenant`, `tenant-admin`, `domains`, `settings` (org **branding** config only — thin, 1 subpage), `install`, `setup` | One-time or rare tenant-owner configuration; no operational officer ever touches these day to day. |
| Security / IAM config | `identity` (api-keys, breakglass, sessions, webauthn), `policy` (ABAC bindings/evaluation) | Security configuration surfaces, intentionally admin-only. |
| Low-code authoring tools | `designer` (form/workflow builder), `metadata` (entity/field/form/rule schema editor), `journeys` (marketing-journey builder) | These are desktop authoring canvases, not data you consume — the mobile form factor doesn't fit the task, not just "lower priority." |
| Dev/commercial admin | `developer-portal` (API keys/webhooks), `billing` (tenant's own SaaS subscription/GSTN/invoices), `plugins` | Platform operators and CivitasOne's own commercial team, not customer-side officers. |
| Desk-bound analytics/ops tooling | `analytics` (BI dashboards, data warehouse, ML insights, ad-hoc `queries`), `recommendations` (health/matrix/NBA — this is the recommendation-*engine's* monitoring console, not a recommendation a user acts on), `cdp` (customer-data-platform identity resolution/segments) | Real modules, real users — but the users are desk-bound analysts, and the UI shape (dense tables, query builders, dashboards) doesn't translate to a phone. Different rationale from the admin cluster, same conclusion. |
| Non-portable / thin UI mechanism | `help` (in-app product-tour overlay for the web app itself, not a data domain), `library` (2 files, `page.tsx` + `loading.tsx` — no content to port) | Not business data; `help`'s mobile equivalent (if wanted) would be native onboarding, not a ported screen. `library` is too thin to even classify with confidence — flag for a maintainer to confirm it isn't dead. |

**Net effect if accepted:** the mobile target shrinks from 61 to **37 modules**
(61 − 24 exclusions), of which 22 already have some real coverage (§3) and 15 are
open gap (§4).

## 3. Already covered — including two that are much shallower than "covered" implies

22 modules have at least one real, shipped mobile feature today:

`assets`, `citizen`, `contracts`, `crm`, `dashboard`, `estab`, `finance`, `grants`,
`helpdesk`, `hr`, `inventory`, `knowledge`, `legal`, `meeting`, `notifications`,
`procurement`, `projects`, `reports`, `revenue`, `visitor`, `workflow`, `works`.

Two of these are **"covered" only in the sense of having a foothold**, and are
genuinely high-value depth candidates in their own right, not just width candidates
elsewhere in this doc:

- **`citizen`** — the web module is huge (`alerts`, `appeals`, `catalogue`,
  `certificates`, `discovery`, `documents`, `eligibility`, `feedback`, `grievances`,
  `intake`, `notices`, `payments`, `portal`, `requests`, `rti`, `services`,
  `surveys`); mobile's `citizen_requests` folder covers only request
  filing/tracking. Certificates, RTI requests, appeals and eligibility checks — the
  things a citizen most plausibly wants an officer to pull up while standing at a
  counter or in the field — are all still web-only. This is arguably comparable in
  value to any Tier-1 gap item below and should be weighed against `field` when
  scoping tranche 4.
- **`revenue`** — mobile covers `trade-licenses` and `assessees` (read-only
  list/detail) out of thirteen web subsections (`adjustments`, `analytics`, `bbps`,
  `config`, `instalments`, `receipts`, `recovery`, `refunds`, `waivers`,
  `write-offs` remain). Tranche 2 already established that several of the obvious
  next picks here (arrears, waivers) are maker-checker-only or GET-less — treat any
  further revenue depth work as needing the same live-route check before committing.
- **`estab`** — mobile covers DAK inbox / eFile / file-noting (correspondence). Web
  `estab` also has `guesthouse`, `quarters`, `vehicles`, `approval-matrix`,
  `compliance`, `dispatch`, `handover`, `meetings`, `migration`, `operators`,
  `workspace` — office/estate administration, still unbuilt. Natural extension of an
  already-proven pattern (see Tier 2, §4).

One folder is **not** covered despite having a mobile presence: `apps/mobile/lib/features/inspection/`
has 3 screens but is dead code — no router entry, no import anywhere, and every data
method is a `TODO: wire to actual API endpoint` stub (this was flagged in the
gap-report row itself). It is listed under the gap, not here, because zero of it
actually works today.

## 4. Prioritized remaining gap — 15 modules

These are the modules with **no real mobile coverage** and not on the exclusion
list. Ordered by (persona fit + confirmed backend readiness) ÷ estimated effort.

### Tier 1 — highest priority, recommended for tranche 3

1. **`field`** (`services/field-service`, mobile: none). This is the single
   biggest surprise in this audit: the mobile app's own architecture doc
   (`docs/MOBILE.md`) headlines "field... usage" as the app's reason to exist, and
   `field-service` already has a real, mature `tasks` module — I read
   `services/field-service/src/modules/tasks/routes.ts` directly: it has a proper
   `listQuery` Zod schema with `limit`/`offset`/`status`/`assigneeId`/`dueBefore`/
   `dueAfter`, and role-gates on exactly `field_agent`/`field_admin` — i.e., built
   for precisely this app's own user. A `visits` module sits alongside it. Zero
   mobile screens exist for either. **This is the clearest, most defensible tranche-3
   pick**: real backend, real pagination (won't repeat tranche 1's truncation bug),
   role model already matches the app's persona.
2. **`approvals`** (backend: `services/workflow-service`, modules `tasks` and
   `workbaskets` — no dedicated `approvals-service` exists, it rides on
   workflow-service). High leverage: a single "my pending approvals" inbox screen
   would give visibility into pending items across whatever business processes
   route through workflow-service, without building bespoke screens per source
   module. Also headlined in `docs/MOBILE.md` alongside "attendance" as a flagship
   use case, yet has no feature folder today. Route-level GET viability not yet
   confirmed (unlike `field`, I only confirmed the module directories exist, not
   the route schema) — a tranche picking this up should check that first, the way
   tranche 2 checked arrears/waivers.

### Tier 2 — good value, real backend confirmed to exist, more scoping needed

3. **`documents`** (`services/document-service` exists). Viewing/uploading
   documents on the go is a plausible field need; scope to read-only list+detail
   first (same shape as tranche 1/2's read-only pattern) before considering upload.
4. **`inspection`** — not net-new: 3 dead-code screens already exist
   (`apps/mobile/lib/features/inspection/`) but every data call is a stub. This is
   blocked on a **backend** dependency (real inspection endpoints don't exist yet),
   not a mobile/routing dependency — cheaper to finish than to build from scratch
   *once the backend exists*, but that's a cross-team dependency outside what a
   mobile-only tranche can close alone. Flag to whoever owns backend prioritization
   rather than picking this for a mobile-only tranche.
5. **`court`** (`services/court-service` exists). Specialist audience (legal/circuit
   officers) but a real, mobile-plausible one (court officers travel between
   hearings). `cases`/`hearings`/`cause-list`/`orders` on web suggest a natural
   read-only "my cause-list today" mobile screen.

### Tier 3 — real modules, lower urgency or need scoping/dedup first

6. **`municipal`** — looks deceptively simple (a single `[serviceKey]` dynamic
   route) but has **no dedicated backend service**; it's a thin UI layer that fans
   out to whichever service backs each citizen service type. Actual mobile effort
   here is closer to "N small integrations" than "one screen" — needs its own
   scoping pass, not a tranche picking it up cold.
7. **`stock`** — distinct web module from `inventory` (`ledger`/`dashboard`/`items`,
   separate from inventory's `bins`/`cycle-counts`/`goods-returns`/`reservations`).
   Mobile's `stock_scanner` most plausibly serves inventory's barcode workflows
   (bins, cycle-counts), not stock's ledger view — worth confirming which backend
   `stock_scanner` actually calls before assuming any overlap.
8. **`fleet`** — thin web module (just `vehicles`); note web `estab` *also* has its
   own `vehicles` subfolder. Resolve which one is canonical before building either.
9. **`catalogue`** — procurement product/rate catalogue browsing; real value for
   procurement officers but a desk-oriented purchasing workflow more than a
   field one.
10. **`establishment`** — extremely thin (`files` only). Not worth a standalone
    mobile target; if pursued, fold into `documents` or `estab` scope rather than
    tracking separately.
11. **`learning`** — LMS (courses, assessments, competency, training plans). Some
    mobile value (reminders, quick assessments) but core courseware consumption is
    inherently desk/screen-time, not field-officer-shaped.

### Tier 4 — defer; desk-bound or niche audiences, revisit only after Tiers 1–3

12. **`audit`** — CAG/vigilance/risk-register review is inherently deep desk-bound
    document review.
13. **`change`** — change-management coordination (`comms`, `calendar`); real but
    niche desk role.
14. **`loyalty`** — citizen rewards/accruals; citizen-engagement nice-to-have, not
    core officer workflow.
15. **`telephony`** — call-center agent console (`agents`/`calls`/`dispositions`);
    wrong form factor for a field app regardless of priority — a call-center agent
    is, by definition, at a desk with a headset.

## 5. Full 61-module ledger

| Module | Bucket | Mobile today | Note |
|---|---|---|---|
| admin | Exclude | — | tenant admin |
| ai | Exclude | — | platform AI-agent config |
| analytics | Exclude | — | BI/data-warehouse/ML-insights dashboards |
| approvals | Gap — Tier 1 | — | workflow-service tasks/workbaskets exist |
| assets | Covered | `assets` | |
| audit | Gap — Tier 4 | — | CAG/vigilance, desk-bound |
| billing | Exclude | — | tenant's own SaaS subscription/GSTN |
| catalogue | Gap — Tier 3 | — | procurement catalogue, desk-oriented |
| cdp | Exclude | — | customer-data-platform admin |
| change | Gap — Tier 4 | — | change-mgmt coordination, niche |
| citizen | Covered (shallow) | `citizen_requests` | huge module, only request-filing covered |
| contracts | Covered | `contracts` | |
| court | Gap — Tier 2 | — | court-service exists |
| crm | Covered | `crm`, `customers` | via offline-sync mailbox pattern |
| dashboard | Covered | `dashboard` | shell only, no independent data domain |
| designer | Exclude | — | low-code form/workflow builder |
| developer-portal | Exclude | — | API keys/webhooks |
| documents | Gap — Tier 2 | — | document-service exists |
| domains | Exclude | — | tenant domain setup, 1 subpage |
| estab | Covered (shallow) | `estab` (DAK/eFile/file-noting) | guesthouse/quarters/vehicles/dispatch/handover etc. still open |
| establishment | Gap — Tier 3 | — | thin (`files` only); consider folding into documents/estab |
| field | Gap — Tier 1 | — | **recommended tranche-3 pick**; field-service tasks/visits ready |
| finance | Covered | `finance`, `expenses`, `invoicing`, `payments` | |
| fleet | Gap — Tier 3 | — | thin; dedup against estab/vehicles first |
| grants | Covered | `grants` | |
| help | Exclude | — | in-app product tour, not a data domain |
| helpdesk | Covered | `helpdesk` | |
| hr | Covered | `hr`, `attendance`, `directory` (employee directory + ID card) | |
| identity | Exclude | — | IAM/security config |
| inspection | Gap — Tier 2 (special) | dead-code screens exist | blocked on backend, not mobile |
| install | Exclude | — | tenant onboarding wizard |
| inventory | Covered | `inventory`, `stock_scanner` | |
| journeys | Exclude | — | marketing-journey builder |
| knowledge | Covered | `knowledge` | |
| learning | Gap — Tier 3 | — | LMS, mostly desk-oriented |
| legal | Covered | `legal` | |
| library | Exclude | — | 2 files, effectively empty |
| locations | Exclude | — | geo/jurisdiction master-data config |
| loyalty | Gap — Tier 4 | — | citizen rewards, not officer workflow |
| meeting | Covered | `meetings` | |
| metadata | Exclude | — | entity/field/form/rule schema editor |
| municipal | Gap — Tier 3 | — | no dedicated backend; needs its own scoping |
| notifications | Covered | `notifications` | |
| platform-admin | Exclude | — | platform operator console |
| plugins | Exclude | — | plugin registry admin |
| policy | Exclude | — | ABAC config |
| procurement | Covered | `procurement` | |
| projects | Covered | `projects` | |
| recommendations | Exclude | — | recommendation-*engine* monitoring console |
| reports | Covered | `reports`, `mis` | |
| revenue | Covered (shallow) | `revenue` (trade-licenses, assessees) | 11 of 13 subsections still open, several maker-checker-only |
| settings | Exclude | — | org branding config, 1 subpage |
| setup | Exclude | — | tenant setup wizard |
| stock | Gap — Tier 3 | — | distinct from inventory; confirm stock_scanner's real target first |
| telephony | Gap — Tier 4 | — | call-center desk console |
| tenant | Exclude | — | tenant admin |
| tenant-admin | Exclude | — | tenant admin |
| themes | Exclude | — | branding/theme config |
| visitor | Covered | `visitor`, `visitor_pass` | |
| workflow | Covered | `workflow` | process engine itself; approvals *inbox* is the separate gap above |
| works | Covered | `works` | |

**Totals:** 24 exclude + 22 covered (2 flagged shallow) + 15 gap = 61.

## 6. Recommendation for tranche 3

Build **`field`** (Tier 1, #1) — read-only Tasks list+detail for `field_agent`/
`field_admin`, same shape as tranches 1–2 (list screen with offset pagination and a
"Showing X of Y" footer from the start this time, not as a fast-follow). Confirm the
`visits` module's route shape before deciding whether to fold it into the same
tranche or split it into tranche 3b. After `field`, `approvals` (Tier 1, #2) is the
next clear pick, pending a live route-viability check on workflow-service the way
tranche 2 checked arrears/waivers.
