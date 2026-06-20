You are resolving the helpdesk architectural duplication.
Read `services/citizen-service/src/modules/helpdesk/` and `services/helpdesk-service/`.

## Problem

- Web helpdesk screens call **citizen-service**: `/api/v1/citizen/tickets`, analytics
- **helpdesk-service** exposes `/api/v1/helpdesk/tickets` — orphaned, duplicate maintenance
- Contract test expects both modules

## Decision required (implement Option A unless blocked)

**Option A (Recommended):** Citizen-service owns **external/citizen-facing** tickets; helpdesk-service owns **internal ops** tickets.

1. Rename web routes: keep citizen APIs for citizen portal; add internal helpdesk loader using helpdesk-service for `/helpdesk/internal` screen.
2. Document in `docs/architecture/helpdesk.md` which API each UI uses.
3. Deprecate duplicate logic — shared types in `@civitasone/types`, no copy-paste validators.

**Option B:** Merge helpdesk into citizen-service, remove helpdesk-service from gateway registry.

## Deliverables

- Architecture decision doc (1 page)
- Gateway + web aligned to chosen option
- Update `tests/contract/gateway.contract.test.ts`
- Migration plan if merging DBs

## Do NOT

- Break existing `/helpdesk/tickets` web screen (must keep working)
