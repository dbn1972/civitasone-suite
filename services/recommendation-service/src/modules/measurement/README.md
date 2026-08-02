# measurement — cross-sell attribution, attach rate and uplift

Covers RTM row **XS-003**. The RTM points at analytics-service for the dashboards; this
module owns the part that belongs to recommendation-service — attributing an outcome
back to the recommendation that produced it, and computing the metrics. It renders no
dashboards and reads no other service's tables.

## Why there are two tables

Attach rate and uplift are ratios, and a ratio needs a denominator that outcomes alone
cannot supply.

| Table | Role |
|---|---|
| `cross_sell_exposures` | the **denominator** — one row per subject per campaign, recording its cohort. A control/holdout subject appears here and is served nothing, which is exactly what makes it a control. |
| `cross_sell_attributions` | the **numerator** — one row per outcome, carrying the recommendation credited with it. `recommendation_id` is nullable because a holdout converts without ever having been recommended anything, and that conversion is the baseline. |

`campaignKey`, `outcomeType` and `cohort` values are tenant-defined strings.

## Units — and why

**Money** is `bigint` minor units (`attributed_amount_minor`) and is serialised as a
**string** in JSON. Above 2^53 a JSON number silently loses paise. Nothing in this
module puts money through a float.

**Ratios are integer basis points** (1 bps = 0.01%, 10000 bps = 100%), not floats and
not money. Three reasons:

1. A binary float cannot hold 0.1 exactly, so two runs that should agree can differ in
   the last digit and a dashboard shows a change that is not one.
2. Every ratio here is a quotient of two integer counts, so an exact integer form
   exists: `round(numerator * 10000 / denominator)`. The multiply happens before the
   divide, so the numerator stays an integer and there is exactly one rounding step.
3. bps is already the unit this service uses for configuration weights, so one scale
   covers the whole cross-sell path.

Rates are **derived on read, never stored** — storing a rounded rate would make the
numbers un-recomputable when the reporting window changes.

## Zero denominators

A rate whose denominator is zero is **undefined, not zero**. Reporting 0% for "we have
not run the experiment on anyone yet" reads as a failure and is a lie. So:

- `attachRateBps` is `null` when the cohort has no exposures, with a note saying why.
- `averageValuePerConversionMinor` is `null` when nothing converted.
- `absoluteUpliftBps` is `null` unless **both** cohorts have at least one exposure.
- `relativeUpliftBps` is `null` when the control attach rate is zero — the absolute
  uplift still carries the finding.
- `relativeUpliftBps` is **not capped** at 10000: a campaign that triples the baseline
  is +20000 bps, and clamping would hide the size of the win. A negative uplift is
  reported as-is; a campaign that loses to its holdout is an important result.

`ratioToBps` is the only division site in the module and it checks its denominator
before dividing, so no metric can produce `NaN` or `Infinity`.

## Attribution

`attributeOutcome` picks which served recommendation earns credit. A touch is eligible
only if it was served **at or before** the outcome (one served afterwards cannot have
caused it), is within `lookbackDays` (inclusive at the boundary), and matches the
product when the caller asks for product matching. `last_touch` credits the latest
eligible touch, `first_touch` the earliest; a same-instant tie breaks on
`recommendationId` ASC so the choice is total and reproducible.

## Write pattern

- **Cohort assignment** is configuration-shaped (one row, must be readable immediately)
  so it writes inline in a transaction with its outbox event, as `matrix/routes.ts` does.
- **Recording an attribution** is event-shaped, so it goes
  route → `recommendation.attribution.record` → `consumer.ts` → outbox event, and
  answers 202. The route makes the attribution *decision* synchronously (it depends on
  the served log the caller cannot see) and writes **nothing**; the consumer writes
  exactly one row. There is no path on which both touch it.
- The consumer calls `markProcessed` first — a redelivery must not inflate the
  numerator of every metric — and wraps its DB work in `runWithTenant()`, because a
  consumer has no `app.tenant_id` GUC and both tables are FORCE ROW LEVEL SECURITY.

## Routes

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/v1/recommendations/measurement/exposures` | admin | 201, assigns a cohort |
| POST | `/v1/recommendations/measurement/attributions` | reader | 202, command → consumer |
| GET | `/v1/recommendations/measurement/attributions` | reader | paginated log |
| GET | `/v1/recommendations/measurement/attach-rate` | reader | one cohort |
| GET | `/v1/recommendations/measurement/uplift` | reader | treatment vs control |

## Events

`recommendation.cohort.assigned` and `recommendation.outcome.attributed` — payload
shapes documented in `src/topics.ts`. analytics-service consumes the latter to build the
dashboards the RTM refers to; it does not read these tables.

## Tables

`recommendation.cross_sell_exposures`, `recommendation.cross_sell_attributions` —
migration `0008_cross_sell_measurement.sql`. RLS enabled and forced on both. A database
CHECK enforces that a control-cohort row carries no recommendation, because a corrupted
holdout invalidates every uplift figure computed from the campaign.
