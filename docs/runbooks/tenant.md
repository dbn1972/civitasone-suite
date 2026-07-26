# Runbook: tenant-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, p95 read < 200 ms, tenant isolation guarantee 100%.

- **Purpose:** tenant registry and lifecycle — tenant creation/update/suspension/onboarding, plan management (feature tiers), subscription lifecycle (create/upgrade/cancel/renew/suspend), org-hierarchy management (departments/divisions per tenant), quota management (storage, users, API rate limits per plan), tenant settings (timezone, locale, branding), data-migration tooling, and isolation mode configuration (shared-DB vs silo). Owns `civitas_tenant`.

- **Owner / escalation:** primary: Platform Engineering. Secondary: SRE. Page on tenant isolation failure (cross-tenant data leak = P0 security incident).

- **Dependencies:**
  - Own Postgres DB (`civitas_tenant`), RLS enabled. This is the tenant-of-tenants registry — stores metadata about all tenants.
  - Redis — tenant config cache (every service resolves tenant config on each request — must be fast).
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for tenant CRUD/suspend/onboard/set-isolation, plan CRUD, subscription lifecycle, org-hierarchy, quota, settings, data-migration; events for tenant created/updated/suspended, subscription changes, quota exceeded.
  - Cross-service: identity-service (Keycloak realm per tenant), install-service (DB provisioning for silo tenants), admin-service (tenant management UI), all services (resolve tenant config for RLS).
  - Tenant isolation: `setIsolation` configures whether a tenant uses shared-DB (RLS row filtering) or silo (dedicated Postgres database). Silo tenants require DB provisioning via install-service.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: tenant count by plan/status, subscription churn, quota utilization heatmap, org-hierarchy depth, data-migration queue.
  - Alert: tenant creation failure = WARN; quota exceeded for any tenant = INFO (auto-enforced); tenant suspension without admin action = CRITICAL (investigate).

- **Common failure modes → action:**
  - *Tenant creation not completing* → creation involves: (1) insert tenant record, (2) trigger identity-service for Keycloak realm, (3) trigger install-service for DB provisioning (if silo). If any step fails, the tenant is in a partial state. Check which downstream event was not processed and re-trigger. Creation is idempotent per tenant ID.
  - *Tenant config cache stale* → every service fetches tenant config (timezone, locale, modules enabled) from Redis. If a tenant setting change isn't reflecting, force-invalidate the tenant's cache key (`tenant:{tenantId}:config`). TTL is 5 minutes by default.
  - *Subscription upgrade not activating* → upgrades change the plan tier and corresponding quotas. If the upgrade event isn't reflecting, check the subscription consumer. The billing-service also consumes subscription events — verify bidirectional sync.
  - *Org-hierarchy circular dependency* → departments form a tree (parent-child). If a circular reference is detected, the domain logic rejects it. If somehow a cycle was inserted (bug), it will cause infinite loops in hierarchy resolution. Fix immediately by updating the parent reference.
  - *Data migration stuck* → tenant data migration (between isolation modes or between platforms) runs in batches. If stuck, check the batch cursor (which table/offset is it on). Migration is resumable — re-trigger from the last checkpoint.
  - *Quota enforcement not working* → quotas are checked at the service level (each service calls tenant-service to check quota before allowing resource creation). If enforcement isn't working, verify the quota check endpoint is reachable and returning accurate counts.

- **Rollback:** redeploy previous image tag. Tenant records are immutable (never delete a tenant — only suspend). Plan definitions are versioned.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) immediately rebuild the tenant config cache (all tenants); (2) verify no tenants are in an inconsistent isolation state (shared vs silo); (3) confirm subscription statuses match billing-service records.
