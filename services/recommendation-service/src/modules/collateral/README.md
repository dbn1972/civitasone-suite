# collateral module (CR-AI-02)

Links a served recommendation to the sales collateral a rep should use when acting on it.

## Purpose

`collateral_links` holds an ordered deck per recommendation. `collateralType` is one of
`document | video | brochure | case_study | pricing_sheet`. `collateralRef` is an opaque
reference into the owning service (knowledge, catalogue, object storage) — deliberately not
a foreign key, because that data lives in another database and cross-schema joins are
forbidden by the module-isolation rule.

Ordering is `ordinal` ascending with `id` as a stable tie-break, so the same deck renders in
the same order on every read.

## Routes

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/recommendations/:id/collateral` | Ordered deck, paginated |
| POST | `/v1/recommendations/:id/collateral` | Attach — publishes a command, returns **202** |
| DELETE | `/v1/recommendations/collateral/:linkId` | Detach (hard delete — association data) |
| GET | `/v1/recommendations/collateral/types` | Supported collateral kinds |

## Commands and events

- Command `recommendation.collateral.attach` → `consumer.ts` (calls `markProcessed` first)
- Event `recommendation.collateral.attached` — `{ linkId, recommendationId, collateralType }`
- Event `recommendation.collateral.detached` — `{ linkId, recommendationId }`

## Dependencies

- `shared/db`, `shared/outbox`, `shared/infra` (queue + cache)
- `nba/repo` — the recommendation must exist before collateral can be attached
- Migration `0003_collateral_links.sql`
