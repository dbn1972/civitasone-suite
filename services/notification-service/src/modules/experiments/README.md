# experiments — A/B experiments, engagement analytics, click heatmaps (CR-MKT-05)

Owns PG schema **`experiments`**.

## Allocation is deterministic, on purpose

`allocateVariant()` buckets by `SHA-256(experimentId + ":" + subject)` → first 4 bytes →
mod 100. Variants are walked in a stable order (sorted by key) and consume contiguous
bucket ranges sized by their allocation.

A recipient who flipped variants between the send and the follow-up would corrupt the
result, so the mapping must not depend on wall clock, worker identity or row order. It
changes only if the variant set itself changes.

`validateVariants()` requires at least 2 variants, unique keys (compared
case- and whitespace-insensitively) and positive whole percents summing to exactly 100.
A remainder would leave recipients silently unassigned, so it is rejected rather than
rounded.

## Winner determination is a heuristic, not a significance test

Stated plainly because presenting it otherwise would be a lie to the operator:

1. Every variant needs ≥ `MIN_SAMPLE_PER_VARIANT` (100) sends, else `insufficient_sample`.
2. Highest click rate wins **only** if it leads the runner-up by ≥ `MIN_MARGIN_PCT`
   (2 percentage points), else `no_separation`.
3. Ties are never broken. A coin flip dressed up as a result is worse than no result.

No p-value, confidence interval or power calculation is computed anywhere in this module.
`decided: false` is not a statement that the variants are equivalent.

## Heatmap

`buildHeatmap()` counts clicks per 1-based link position, ordered by position, with
`sharePct` as that position's share of all *positioned* clicks (2dp). Clicks with no
recorded position are excluded — they carry no positional information, and including
them in the denominator would understate every cell.

## Routes

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/v1/notification/experiments` | read | paginated `{ data, meta }` |
| POST | `/v1/notification/experiments` | write | 202; 422 on an invalid variant set |
| GET | `/v1/notification/experiments/:id/allocation` | read | which variant a subject lands in |
| POST | `/v1/notification/experiments/:id/events` | write | 202 — record an open/click |
| GET | `/v1/notification/experiments/:id/results` | read | per-variant rates + verdict |
| GET | `/v1/notification/experiments/:id/heatmap` | read | clicks per link position |
| POST | `/v1/notification/experiments/:id/conclude` | write | 202; 409 if already concluded |

## Events

`notification.experiment.created`, `.event.recorded`, `.concluded` — payloads in
`src/topics.ts`.

## Tables

`experiments.experiments`, `experiments.experiment_variants`,
`experiments.experiment_events` — migration
`0026_deliverability_experiments_push_bounces_inbox.sql`. RLS enabled and forced,
tenant-isolation policy on `app.tenant_id`. `(tenant_id, experiment_id, variant_key)` is
unique; variants and events cascade from their experiment.

## No PII

Engagement is attributed to a delivery id and an opaque `subjectKey` (a uuid supplied by
the caller), never to an email address.
