# Runbook: metadata-service

> Tier 3 (early stage — scaffold). Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.0% availability, p95 read < 200 ms.

- **Purpose:** custom object/entity engine — allows tenants to define custom data models (entities with fields, validations, relationships) and business rules without code changes. Owns `civitas_metadata`. 2 modules (entities, rules). Currently in early development (1 migration, 2 tests, no topics.ts). Will evolve into a low-code extensibility platform.

- **Owner / escalation:** primary: Platform Engineering. Secondary: SRE (low priority — service is not yet actively used in production workflows).

- **Dependencies:**
  - Own Postgres DB (`civitas_metadata`), RLS enabled, tenant-scoped.
  - Redis — entity schema cache (custom entity definitions are loaded on every request that touches custom objects).
  - No queue topics defined yet (service is pre-CQRS, likely using direct writes during development phase).
  - Cross-service: once mature, other services will query metadata-service to resolve custom field definitions. Currently standalone.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ if applicable, consumer error rate).
  - Grafana: custom entity count per tenant, rule evaluation rate.

- **Common failure modes → action:**
  - *Entity schema cache stale* → if a custom entity definition is updated but queries return the old schema, force-invalidate the cache key (`metadata:{tenantId}:entity:{entityId}`).
  - *Rule evaluation error* → business rules are tenant-defined (expressions/conditions). If a rule evaluates incorrectly, check the rule definition syntax. Since rules are user-authored, errors are expected — the service should return clear validation errors, not 500s.
  - *Service not starting* → with only 1 migration, check if the migration was applied to the target DB. The service needs its Postgres database and schema to exist.

- **Rollback:** redeploy previous image tag. Custom entity definitions are tenant data — they persist independently of code deploys.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup. Low urgency (service is in early stage). After restore: rebuild entity schema cache.

- **Maturity note:** this service is in scaffold stage (1 migration, 2 tests, no topics.ts). It is NOT production-critical. Do not rely on it for business-critical workflows until it reaches Tier 2 maturity (proper CQRS, test coverage ≥80%, dedicated migration schema).
