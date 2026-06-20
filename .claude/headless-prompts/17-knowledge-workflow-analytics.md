You are implementing the three modules with HTML prototypes but no backend services.
Read `MODULES_AND_SCHEMA.md` modules 13–15 and `MASTER_BUILD_BRIEF.md`.

## Modules

| Module | Prefix | Prototype folder |
|--------|--------|------------------|
| Knowledge & DMS | `knowledge_`, `records_` | `knowledge-module/web/` |
| Workflow & BPM | `workflow_`, `bpm_` | `workflow-module/web/` |
| Data & Analytics | `analytics_`, `dw_` | `analytics-module/web/` |

## Step 1 — Service scaffolding (each)

Create `services/knowledge-service`, `workflow-service`, `analytics-service` following `crm-service` template:

- `migrations/0001_init.sql`
- CQRS modules with `routes.ts`, `commands.ts`, `queries.ts`, `consumer.ts`, `worker.ts`
- Register in `gateway-service/src/registry.ts` (unique ports 3028–3032)
- Add DB bootstrap in `infra/db/bootstrap/bootstrap_new_services.sql`

## Step 2 — Minimum API surface (per service)

**Knowledge:** `POST/GET /v1/knowledge/documents`
**Workflow:** `POST/GET /v1/workflow/instances`, `POST /v1/workflow/tasks/:id/complete`
**Analytics:** `GET /v1/analytics/dashboards`, `POST /v1/analytics/queries/run`

## Step 3 — Web (optional in same PR)

One list screen per module under `apps/web/src/app/(app)/`.

## Rules

- Queue-first writes (`sendAccepted`)
- Cache-first reads (`listOrLoad`)
- No stubs — full CQRS stack even if minimal domain

## Reference

Copy patterns from `services/crm-service` (deals/activities modules added in gap fix).
