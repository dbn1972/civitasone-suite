# S8-G2: pay components, the contract

Section 8 gap G2 (design section 3). Branch `feat/s8-g2-components`, payroll migration `0170`.
Everything is behind **`S8_PAY_COMPONENTS_ENABLED`** (payroll-service env, only the exact string `true` enables it, default off).

## The one module G1 builds on

`services/payroll-service/src/modules/pay-components/model.ts` (pure, no I/O). The web mirror is
`apps/web/src/lib/payComponents.ts`; `GET /v1/payroll/pay-components/meta` returns the same sets at run time.

| Export | Values |
|---|---|
| `STRUCTURE_KINDS` | `run` (every structure today), `ctc_template` |
| `COMPONENT_CALC_TYPES` | `pct_of_ctc`, `pct_of_basic`, `fixed`, `balancing` |
| `EMPLOYER_COST_CLASSES` | `employer_pf`, `employer_esi`, `gratuity_provision`, `group_insurance`, `other_employer` |
| `STATUTORY_DERIVED_CLASSES` | `employer_pf`, `employer_esi` (no calc, no amount: the engine derives them from the effective-dated statutory config) |
| `COST_PLACEMENTS` | `inside_ctc`, `on_top` (employer cost sits inside or on top of CTC; only for employer costs) |
| `COMPONENT_TYPES` | `earning`, `deduction`, `employer_cost` |
| `validateComponentSpec(kind, spec, {isNew})` | the per-component rules below |
| `checkTemplate(lines)` | the template-level checks below |
| `payComponentsEnabled()` / `PAY_COMPONENTS_FLAG` | the flag |

## Columns (migration 0170, additive, idempotent)

`payroll.payroll_structures`: `kind` (default `run`), `is_locked`, `locked_at`, `locked_by`, `effective_from`,
`template_version` (default 1), `parent_structure_id`, `lineage_root_id` (every structure is the root of its own lineage; new versions inherit it). Unique `(tenant_id, lineage_root_id, template_version)`. (`version` stays the optimistic row counter.)

`payroll.payroll_components`: `is_active`, `calc`, `pct_of_ctc_bps` (0..10000), `employer_cost_class`,
`cost_placement`, `counts_for_pf_wage`, `counts_for_esi_wage`, `counts_for_gratuity`, `lop_applicable`, `payslip_order`.
`component_type` now also allows `employer_cost` (CTC templates only). Existing columns `pct_of_basic numeric(5,2)` and
`fixed_minor bigint` (paise) hold the amounts. Backfill: `calc` from the old pct/fixed with the engine precedence
(positive `pct_of_basic` wins), every flag `false`, `is_active` true, so today's behaviour is preserved.
Unique `(tenant_id, structure_id, code)` already existed (0001); added: at most one active `balancing` per structure.

## What a component row means

A line has exactly one of: `calc=fixed` with `fixed_minor`; `calc=pct_of_basic` with `pct_of_basic`; `calc=pct_of_ctc` with
`pct_of_ctc_bps`; `calc=balancing` with no amount (the remainder of monthly fixed CTC, normally SPECIAL allowance);
or an employer PF / ESI line with `calc` NULL and no amount. `calc` NULL on a pre-existing run row means "legacy: read
`pct_of_basic` / `fixed_minor` as before" (`effectiveCalc()` in `api.ts`). A component is an employer cost iff
`employer_cost_class` is set (then `component_type = employer_cost`). The G1 engine reads: `calc`, the amount column for
that calc, `employer_cost_class` + `cost_placement`, and the four flags (`counts_for_pf_wage`, `counts_for_esi_wage`,
`counts_for_gratuity`, `lop_applicable`) as the wage bases. Only `is_active` rows count. Order is `payslip_order`.

## Rules the API enforces (and the consumer re-checks under a row lock)

* `run` structure (what the live engine honours): `earning`/`deduction`; `fixed` or `pct_of_basic` only; codes `BASIC`, `DA`,
  `HRA` rejected on create (the engine skips them); no employer class, no wage flags, no `lop_applicable` (the run engine does
  not honour them yet, so they are refused rather than silently ignored).
* `ctc_template`: `earning` or `employer_cost`; all four calc types; wage flags and `lop_applicable` allowed; `balancing` only
  on an earning; employer PF/ESI take no calc.
* Code: `^[A-Z][A-Z0-9_]{1,31}$`, immutable, unique per structure, a deactivated row keeps its code.
* Template checks (owner decision 1): **error** on a second balancing line and on percent-of-CTC lines above 100%;
  **warning** (VERIFY) when BASIC is under 50% of CTC, no BASIC, no balancing line. A negative balancing figure is a
  computation-time block in G1, not here.
* Immutability: a structure is locked if `is_locked` or any run past `draft`/`failed` references it. Locked => 409
  `STRUCTURE_LOCKED`; use `new-version` (copies active components into an unlocked structure with `template_version + 1`).
* Versions: `new-version` serialises on the lineage root, numbers the new version `max(template_version of the lineage) + 1`
  (never reused, whichever version it is made from) and requires an explicit `effectiveFrom` strictly later than every
  existing version's (422 `EFFECTIVE_FROM_NOT_LATER`). The unique index is the backstop.
* `pct_of_ctc` cap (100%): counts earnings and `inside_ctc` employer lines. An `on_top` employer cost is paid in addition to
  CTC: it does not use up the 100% and is not taken out of the balancing remainder.
* Maker-checker on a CTC template: lock needs `payroll_admin`/`super_admin` and a different person from the last editor.

## Resolver: the only way the CTC engine reads a template

`resolveTemplateForMonth(tx, tenantId, lineageRootId, 'YYYY-MM')` in `rules.ts` (pure rule: `pickTemplateVersion` in `model.ts`).
It returns only `kind = 'ctc_template' AND is_locked` versions, the latest whose `effective_from` is on or before the end of
the month (ties: higher `template_version`), with its **active** components in payslip order; `null` if no approved template
covers the month. **The CTC engine must use locked templates only, through this resolver**, never read a structure id directly:
an unlocked draft or a run structure must never drive a slip. Mid-month effective dates are the engine's proration concern.

## API (all 404 `PAY_COMPONENTS_DISABLED` while the flag is off, except `/meta`)

`GET /v1/payroll/pay-components/meta` · `GET|POST /v1/payroll/ctc-templates` · `GET /v1/payroll/structures/:id/components` ·
`POST /v1/payroll/structures/:id/components` · `PATCH .../components/:cid` (optimistic `version`) ·
`POST .../components/:cid/deactivate|reactivate` (`reason` >= 10 chars) · `POST .../components/reorder` ·
`POST /v1/payroll/structures/:id/lock` · `POST /v1/payroll/structures/:id/new-version`.
Writes are CQRS commands (202 + consumer, `markProcessed` dedupe, audit event each). Reads: `payroll_admin`,
`payroll_officer`, `super_admin`, `hr_admin`. Writes: all but `hr_admin`. Money is a digit string of paise.

## Effect on existing paths (flag off, and on)

* `GET /v1/payroll/components` returns the legacy keys only unless the flag is on, and never lists template components.
* `GET /v1/payroll/structures` lists `kind = 'run'` only; `POST /v1/payroll/runs` refuses a non-run structure.
* The run reads active components only (`is_active`; every old row is active).
* Not done here (G1): the CTC engine itself, per-employee structure assignment, taxability/exclusion lines (owner Q11),
  per-employee component override, effective-dated template activation. The wage flags are stored and exposed, not yet consumed.

## VERIFY

The 50% basic warning (labour-code wage definition) and the `gratuity_provision` default of 4.81% of basic quoted by the
owner are not seeded anywhere; nothing in this change contains a statutory figure.
