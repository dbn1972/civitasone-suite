# authoring module (AG-003)

No-code agent authoring: an author builds an agent definition as a draft, validates
it, publishes it, and eventually archives it.

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/ai/authoring/agents` | List definitions (cache-first, paginated) |
| POST | `/v1/ai/authoring/agents` | Create a draft |
| PATCH | `/v1/ai/authoring/agents/:id` | Edit a draft or published definition |
| POST | `/v1/ai/authoring/agents/:id/publish` | draft → published (gated) |
| POST | `/v1/ai/authoring/agents/:id/archive` | → archived (terminal) |
| POST | `/v1/ai/authoring/agents/:id/validate` | Dry-run validation, persists nothing |

## Events

`ai.authoring.drafted`, `ai.authoring.published`, `ai.authoring.archived`.

## Publish gate

A definition may only be published with a non-empty `systemPrompt` **and** at
least one tool. Anything else returns 422 `NOT_PUBLISHABLE` with structured
issues. `/validate` uses the same `validateDefinition` function, so the dry run
can never disagree with the publish decision.

## Table

`ai_agent.agent_authoring_definitions` (migration 0002). Deliberately separate
from `ai_agent.agent_definitions`, which is the runtime registry with a different
lifecycle (active / paused / archived) and existing live rows.

## Dependencies

`shared/db`, `shared/outbox`, `shared/audit`, `shared/infra` (cache).
