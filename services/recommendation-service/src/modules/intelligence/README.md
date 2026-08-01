# intelligence module (F.6 — key-account intelligence)

White-space map, risk signals and a ranked opportunity score per key account.

## Purpose

One live record per `(tenant, accountId)`. Recompute upserts in place and bumps `version`.

`opportunityScore` is `numeric(6,4)`, computed as white-space upside discounted by risk:

```
score = min(1, usableWhiteSpaceEntries / 8) * (1 - min(1, sum(riskPenalty)))
```

Risk penalties: `low 0.05`, `medium 0.15`, `high 0.3`, `critical 0.6`. Critical is heavy on
purpose — one critical signal should pull an account off the top of the list. The score is a
decimal STRING throughout, never a float (see `predictive/README.md` for the rationale).

`computeOpportunityScore` is pure and deterministic, and the consumer recomputes it rather
than trusting the command payload, so the domain function stays the single source of truth.

## Routes

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/recommendations/accounts/:accountId/intelligence` | One account |
| POST | `/v1/recommendations/accounts/:accountId/intelligence/compute` | Recompute — command, returns **202** |
| GET | `/v1/recommendations/accounts/intelligence` | Ranked — `minOpportunityScore`, `limit` |

## Commands and events

- Command `recommendation.intelligence.compute` → `consumer.ts` (calls `markProcessed` first)
- Event `recommendation.intelligence.computed` — `{ accountId, opportunityScore (string), riskCount }`

## Dependencies

- `shared/db`, `shared/outbox`, `shared/infra` (queue + cache)
- Migration `0005_account_intelligence.sql`
