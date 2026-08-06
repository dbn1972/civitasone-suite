# outcomes — outcome capture with reason codes (G18, spec §25.3)

## Purpose

Spec §25.3 (journey J2, step 4) requires that an assisted-outreach interaction ends with a
captured outcome, and that "every outcome feeds the propensity model". §25 more broadly
wants outcomes on **any** journey interaction, not only on leads.

Two things already existed and neither is sufficient:

| Existing | Why it does not cover this |
|---|---|
| `leads/reason-codes-routes.ts` (LQ-004) | Its codes are keyed to LEAD LIFECYCLE statuses (`nurture`, `recycled`, `disqualified`). It cannot say why an outreach call ended, or why a subscription lapsed. |
| `recommendation-service` `measurement` | It owns cross-sell attribution and is a CONSUMER of outcomes. Duplicating its tables here would give two answers to the same question. |

So this module adds a reusable catalogue plus a generic outcome record, and publishes one
event that recommendation-service and analytics-service consume.

## Vocabulary is product-agnostic — deliberately

The platform knows three outcome types and nothing else:

| Generic outcome | Meaning | Required with it |
|---|---|---|
| `converted` | the customer took a product | `productId` (+ optional `amountMinor` / `currency`) |
| `declined` | the customer said no | `reasonCodeId` |
| `deferred` | no decision yet | `followUpNextActionId` (a real `crm.next_actions` row, AC-002) |

The postal reading of §25.3 maps onto them: *reinvested* is `converted` with a product and
an amount, *withdrawn* is `declined` with a reason code, *undecided* is `deferred` with a
scheduled follow-up. Words like "reinvested", "maturity" or a scheme name are a tenant's
`label` in seed data — never a column, never a CHECK value, never an `if` in this code.
A deployment that sells insurance or electricity uses the same three types.

## Tables

- `crm.outcome_reason_codes` (migration 0089) — the catalogue.
  - `category` + `appliesTo` are the applicability discriminators: `category` says which
    kind of record the code describes (`interaction`, `subscription`, …), `appliesTo`
    narrows it to particular outcome types. An **empty** `appliesTo` means "any", so a
    freshly imported catalogue is usable before it is refined.
  - `governance` is `canonical` or `tenant`. Canonical rows are owned by the PLATFORM under
    the sentinel tenant `00000000-0000-0000-0000-000000000000`, are readable by every tenant
    through the RLS policy, and are immutable to tenants (422 for every role, `super_admin`
    included). They are created only by a seed migration, never by a command.
  - `versionNumber` is the CATALOGUE revision and part of the business key
    `(tenant, category, code, versionNumber)`. Retiring a meaning is `active = false`;
    re-defining one is a new row at `versionNumber + 1`. Historic outcomes therefore keep
    pointing at the wording they were captured under. (`version` is the ordinary
    optimistic-lock column.)
- `crm.interaction_outcomes` (migration 0090) — the captured outcome.
  - `subjectType` / `subjectId` reference a `contact`, `deal` or `next_action`. Existence is
    checked at the route boundary; a polymorphic FK is not expressible.
  - `amountMinor` is **bigint minor units** and is serialised as a decimal STRING on the
    wire. A JSON number loses paise above 2^53.
  - `(tenant, subjectType, subjectId, outcomeRef)` is unique. A double-submitted capture is
    a no-op, because a second row would double-count in the propensity feed.
  - There is **no notes column**. An outcome is a coded fact; an agent's prose about a
    customer is PII that would then flow into every analytics export (DPDP Act 2023).

## Routes

| Method | Path | Roles |
|---|---|---|
| GET | `/v1/crm/outcome-reason-codes` | any CRM user (the capture form needs the codes) |
| GET | `/v1/crm/outcome-reason-codes/:id` | any CRM user |
| POST | `/v1/crm/outcome-reason-codes` | `crm_admin`, `tenant_admin`, `super_admin` |
| PATCH | `/v1/crm/outcome-reason-codes/:id` | admin |
| DELETE | `/v1/crm/outcome-reason-codes/:id` | admin |
| GET | `/v1/crm/interaction-outcomes` | any CRM user |
| GET | `/v1/crm/interaction-outcomes/:id` | any CRM user |
| POST | `/v1/crm/interaction-outcomes` | any CRM user — capture is the agent's own record; gating it behind admin is how outcome capture quietly stops happening |

All mutations are CQRS: validate → publish command → 202. The writes are in `consumer.ts`.

## Events

| Topic | When |
|---|---|
| `crm.outcome_reason_code.created` / `.updated` / `.deleted` | catalogue configuration changed |
| `crm.interaction_outcome.recorded` | once per recorded outcome, from inside the same transaction as the insert |

`crm.interaction_outcome.recorded` is the propensity-model feed. It carries
`propensitySignal` (+1 converted / 0 deferred / −1 declined) so the model, cross-sell
attribution and analytics cannot disagree about what a deferral is worth, and it carries
`amountMinor` as a decimal string. Full payload shape is documented on `EVENTS` in
`src/topics.ts`. No PII: identifiers, codes and amounts only.

## Dependencies

- `crm.next_actions` (AC-002) — the follow-up a `deferred` outcome must reference.
- `crm.contacts` / `crm.deals` — subject existence checks.
- `@civitasone/outbox` — transactional event emission; `markProcessed` first, always.
- `@civitasone/cache` — every read is read-through; Redis being down degrades to Postgres
  with a WARN, never a 500.
