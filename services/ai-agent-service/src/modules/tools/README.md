# tools module (F.4)

Governed ReAct tooling: the per-tenant tool catalogue and the reasoning-step
trace that records what an agent thought, did, and observed.

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/ai/tools` | Tool catalogue; `?agentDomain=crm` = CRM/Sales set, `?agentDomain=helpdesk` = Service/ticket set |
| POST | `/v1/ai/tools` | Define a tool |
| POST | `/v1/ai/tools/seed-defaults` | Materialise the default CRM/helpdesk tools for the caller's tenant |
| PATCH | `/v1/ai/tools/:id` | Update a tool definition |
| POST | `/v1/ai/agents/:id/react-step` | Record one ReAct step |

## Events

`ai.tool.defined`, `ai.tool.updated`, `ai.agent.react_step_recorded`,
`ai.agent.react_step_pending_approval`.

## Governance boundary

A tool with `requires_approval = true` is **never executed by the agent**. The
step is persisted with `executed = false` and `status = 'pending_approval'` and the
route answers 202 with `code: "PENDING_APPROVAL"`. The decision comes from
`decideReactStep`, not from the request body, so a caller cannot assert that an
approval-gated action already ran. A disabled tool is rejected with 422
`TOOL_DISABLED`; an action naming a tool that does not exist is a hallucination
and returns 404 `TOOL_NOT_FOUND` rather than being recorded.

## Default tool templates

Defaults live in `domain.ts`, not in the migration: `tool_definitions.tenant_id`
is `NOT NULL`, so a shared template row would either break RLS or leak one
tenant's catalogue into every install. Seeding is idempotent (`ON CONFLICT DO
NOTHING`) and never overwrites a tenant's edits.

## Tables

`ai_agent.tool_definitions`, `ai_agent.react_steps` (migration 0002).

## Dependencies

`shared/db`, `shared/outbox`, `shared/audit`, `shared/infra` (cache),
`modules/agents/repo` (agent existence + status check).
