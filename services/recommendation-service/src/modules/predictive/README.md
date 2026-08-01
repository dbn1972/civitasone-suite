# predictive module (CR-AI-01)

Stores the output of ml-service's predictive models against a subject.

## Purpose

One live score per `(tenant, subjectType, subjectId, modelType)`. Subject types are
`profile | account | deal`; model types are `ltv | renewal | fraud | churn`.

`score` is `numeric(12,4)` and `confidence` is `numeric(5,4)`. **Both are treated as
decimal STRINGS end to end** — Postgres returns numeric as a string and the API keeps it
as one. Casting to a JS `number` would silently lose precision (binary float rounding and
the 2^53 ceiling on large LTV magnitudes). All re-scaling and comparison in `domain.ts` is
pure string arithmetic for the same reason.

## Routes

| Method | Path | Notes |
|---|---|---|
| PUT | `/v1/recommendations/predictive/:subjectType/:subjectId/:modelType` | Upsert a score (ml-service) |
| GET | `/v1/recommendations/predictive/:subjectType/:subjectId` | All model scores for a subject |
| GET | `/v1/recommendations/predictive` | Ranked list — `modelType`, `subjectType`, `minScore`, `limit` |
| GET | `/v1/recommendations/predictive/model-types` | Supported enumerations |

## Events

- `recommendation.predictive.upserted` — `{ scoreId, subjectType, subjectId, modelType, score (string), modelVersion }`

## Dependencies

- `shared/db` (drizzle + `scopedRead`), `shared/outbox` (audit event), `shared/infra` (cache)
- Migration `0002_predictive_scores.sql`
- Read by `nba/ranking-routes.ts` for the propensity ranking signal
