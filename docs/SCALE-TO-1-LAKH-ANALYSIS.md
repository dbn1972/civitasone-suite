# CivitasOne — Scale to 1 Lakh Deployments: 360° Gap Analysis

**Date:** 2026-07-01
**Target:** 100,000+ tenants (Salesforce/SAP Cloud scale for Indian govt/PSU/private)
**Current:** Multi-tenant pool/silo design exists but has gaps for hyperscale

---

## What EXISTS (solid foundation)

| Dimension | Current State | Score |
|-----------|--------------|:-----:|
| Multi-tenancy model | Pool (shared DB + RLS) / Silo (dedicated DB) | 8/10 |
| Tenant isolation | RLS + tenant_id on every query + arch-guard | 9/10 |
| Feature flags | Per-tenant overrides via admin-service | 7/10 |
| Region/residency | Tenant has region + residency fields | 6/10 |
| Plugin system | plugin-service exists (items module) | 5/10 |
| API versioning | /api/v1/ prefix on all routes | 6/10 |
| Containerization | Multi-stage Dockerfile, one per service | 8/10 |
| Queue isolation | SQS per-topic, tenant_id in every message | 8/10 |
| Observability | Pino + OTel + per-route histograms + per-tenant counters | 8/10 |
| Billing | Razorpay integration + subscription plans | 6/10 |

---

## What's MISSING for 1 Lakh Deployments

### 🔴 CRITICAL GAPS (Must solve before scale)

#### 1. NO TENANT-AWARE CONNECTION ROUTING
**Problem:** At 100K tenants, a single Postgres cluster cannot serve all pool tenants. You need **tenant-aware connection routing** — route each request to the correct DB cluster based on tenant's assigned shard.

**Current:** All pool tenants hit ONE Postgres via ONE connection string.
**Need:** A router that maps `tenant_id → database_cluster` dynamically.

**Fix:** Add a `Tenant Registry` lookup in the `@civitasone/db` package:
```
Request → JWT (tenant_id) → Registry lookup → { cluster: "pg-shard-3", dbName: "civitas_pool_3" } → connect
```

#### 2. NO HORIZONTAL SHARDING STRATEGY
**Problem:** RLS on a single DB works for ~10K tenants. Beyond that, you need to **shard by tenant group** (geography, edition, size).

**Current:** All pool tenants in one DB per service (33 DBs total).
**Need:** Multiple DB instances per service, tenants distributed by shard key.

**Fix:** Extend `tenant-service` with a `shard_key` column. The `@civitasone/db` package resolves shard → connection at runtime.

#### 3. NO PER-TENANT RESOURCE QUOTAS
**Problem:** One noisy tenant (100K employees) could consume all DB connections, cache space, and queue bandwidth — starving 99,999 other tenants.

**Current:** Per-tenant rate counter exists (observability) but no enforcement.
**Need:** Hard limits: `max_employees`, `max_files`, `max_api_calls_per_minute`, `max_storage_gb`.

**Fix:** `tenant-service` → `quotas` table + middleware that enforces limits before command acceptance.

#### 4. NO ASYNC TENANT PROVISIONING AT SCALE
**Problem:** Creating 1000 tenants/day (organic growth) requires provisioning to be fully automated: DB creation, schema migration, Keycloak realm, SQS queues, S3 bucket, seed data.

**Current:** `install-service` exists but provisioning is semi-manual.
**Need:** Fully automated `CREATE TENANT → ready in <30s` pipeline.

#### 5. NO MULTI-REGION ROUTING
**Problem:** India has 28 states. State government tenants should route to the nearest datacenter. Central government to Delhi. DPDP Act requires data residency.

**Current:** Tenant has `region` + `residency` fields but no routing logic.
**Need:** DNS-based geo-routing + per-region deployment stacks + cross-region replication for global admin.

---

### 🟠 HIGH GAPS (Solve within 6 months)

#### 6. NO CANARY/BLUE-GREEN DEPLOYMENT
At 100K tenants, you cannot deploy to ALL at once. You need:
- Canary: 1% of tenants get new version first
- Progressive rollout: 1% → 10% → 50% → 100% over 24h
- Instant rollback if error rate spikes

**Current:** No deployment strategy in CI/CD.
**Fix:** Add `deployment_ring` to tenant (ring 0 = canary, ring 1 = early, ring 2 = GA). Deploy by ring.

#### 7. NO EVENT REPLAY / REPROCESSING
When you fix a consumer bug, you need to replay events for affected tenants without re-processing for all. Currently no mechanism for selective event replay.

**Fix:** Event store (append-only log) with replay tooling per tenant + time range.

#### 8. NO TENANT DATA EXPORT / PORTABILITY
A government tender requirement: "we must be able to leave the platform and take our data." No export pipeline exists.

**Fix:** `GET /v1/admin/tenants/:id/export` → generates a ZIP of all tenant data across all 33 services (background job).

#### 9. NO USAGE METERING / BILLING PER CONSUMPTION
Billing service has plans but no per-API-call or per-storage metering. For a SaaS ERP, you need: "Tenant X used 1.2M API calls, 50GB storage, 10K employees this month → bill ₹X."

**Fix:** Metering pipeline (OpenTelemetry → time-series → billing aggregation).

#### 10. NO WEBHOOK / EVENT SUBSCRIPTION FOR INTEGRATORS
External systems (state treasury IFMS, PFMS, NIC portals) need to be notified on events. No outbound webhook system exists.

**Fix:** `notification-service` → outbound webhook module: tenant registers a URL + event filter → platform pushes events as signed HTTP POST.

---

### 🟡 MEDIUM GAPS (Solve within 12 months)

#### 11. NO API RATE LIMITING ENFORCEMENT
Rate limits are configurable in admin but **not enforced** at the gateway. A tenant could fire 100K requests/second.

**Fix:** `@fastify/rate-limit` on gateway-service, keyed by `tenant_id` from JWT.

#### 12. NO SCHEMA MIGRATION ORCHESTRATION
At 100K tenants (some on pool, some on silo), running a migration means: apply to all pool DB shards + all silo DBs. No orchestration exists.

**Fix:** Migration runner that queries tenant registry → applies pending migrations per shard/silo.

#### 13. NO LONG-RUNNING OPERATION TRACKING
Bulk operations (payroll for 50K employees, budget allocation for 10K heads) can take minutes. No progress tracking or cancellation.

**Fix:** Add `operation_status` table: {id, tenant_id, type, progress_pct, started_at, completed_at, cancelled}.

#### 14. NO WHITE-LABELING / THEME PER TENANT
The `theme-service` exists in the service list but no implementation found. For lakhs of deployments, each state government wants their logo/colors.

**Fix:** `theme-service` → stores CSS variables + logo + brand per tenant. Frontend loads dynamically.

#### 15. NO MARKETPLACE / PLUGIN ECOSYSTEM
At scale, you need partners to build modules. The `plugin-service` has one module (items) but no plugin runtime, sandboxing, or marketplace.

**Fix:** Define a plugin contract (hooks, APIs, UI injection points). Plugins run in isolated containers.

---

## Architecture Score for 1 Lakh Scale

| Dimension | Current | Needed | Gap |
|-----------|:-------:|:------:|:---:|
| **Single-tenant correctness** | 9/10 | 9/10 | ✅ |
| **Multi-tenant isolation** | 9/10 | 9/10 | ✅ |
| **Horizontal sharding** | 3/10 | 9/10 | 🔴 |
| **Geo-distribution** | 2/10 | 8/10 | 🔴 |
| **Tenant provisioning automation** | 5/10 | 9/10 | 🟠 |
| **Resource quotas** | 2/10 | 8/10 | 🔴 |
| **Deployment strategy** | 4/10 | 9/10 | 🟠 |
| **API versioning & compat** | 6/10 | 9/10 | 🟡 |
| **Usage metering** | 2/10 | 8/10 | 🟠 |
| **Data portability** | 1/10 | 7/10 | 🟠 |
| **Plugin ecosystem** | 2/10 | 7/10 | 🟡 |
| **Event replay** | 1/10 | 7/10 | 🟠 |
| **White-labeling** | 2/10 | 8/10 | 🟡 |

**Overall Hyperscale Readiness: 4.2/10** (currently ready for ~1000 tenants, not 100K)

---

## Roadmap to 1 Lakh

### Phase 1 — Foundation (Months 1-3): Scale to 10K tenants
1. Tenant-aware connection routing (shard registry in @civitasone/db)
2. Per-tenant resource quotas (max_employees, max_api_calls)
3. Gateway rate limiting enforcement
4. Automated tenant provisioning pipeline (<30s to ready)
5. API rate limiting on gateway

### Phase 2 — Resilience (Months 4-6): Scale to 50K tenants  
6. Horizontal DB sharding (pool → 10 shards by region/edition)
7. Canary deployment rings
8. Event replay tooling
9. Usage metering pipeline
10. Tenant data export

### Phase 3 — Platform (Months 7-12): Scale to 1 Lakh
11. Multi-region deployment (Delhi, Mumbai, Hyderabad, Chennai)
12. DPDP data residency enforcement
13. Plugin marketplace runtime
14. White-labeling / theming
15. Webhook outbound event subscriptions

### Phase 4 — Ecosystem (Year 2): Beyond 1 Lakh
16. Partner SDK + developer portal
17. Self-service tenant migration (pool → silo upgrade)
18. Cross-region disaster recovery
19. Real-time analytics (ClickHouse/TimescaleDB)
20. AI-driven anomaly detection per tenant

---

## Honest Assessment

**For a single government department / PSU / company (1-100 tenants):** The platform is **9/10, production-ready today.**

**For a SaaS offering serving 1000+ organizations:** It's **7/10 — needs quotas, automated provisioning, rate limiting.**

**For true hyperscale (1 lakh deployments):** It's **4/10 — the foundations exist (pool/silo, RLS, region field) but the routing, sharding, metering, deployment ring, and geo-distribution layers don't exist yet.**

This is normal. SAP took 20 years to go from single-tenant to SAP Cloud. Salesforce built their multi-tenant infrastructure over 8 years. The architecture is CORRECT for the journey — the pool/silo model means you can start with 1000 tenants on one cluster and progressively shard without rewriting the application code.
