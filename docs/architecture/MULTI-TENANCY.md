# CivitasOne — Multi-Tenancy Architecture (Tiered: Pool + Silo)

**Date:** 2026-06-28
**Decision:** Adopt **Option B + tiering** — a tenant is either:
- **pool** (default): lives in the shared per-service database, isolated by
  `tenant_id` + Postgres RLS (today's model), or
- **silo** (premium / regulated): has its **own dedicated database** that hosts
  **every service's pg schema** (`budget`, `gl`, `files`, …). All services
  connect to that tenant DB and use only their own schema — so Drizzle models
  are unchanged; only the connection target differs.

One codebase serves both tiers. A tenant's tier is a data flag, not a fork.

---

## 1. Why tiered (not all-silo)

| | Pool | Silo |
|---|------|------|
| Isolation / blast radius | logical (RLS) | **physical (separate DB)** |
| Cost / density | very high density | one DB per tenant (10–50× small-tenant overhead) |
| Noisy neighbour | managed via quotas | structurally isolated |
| Per-tenant backup / erasure / residency / BYOK | harder | **trivial (drop/place/encrypt the DB)** |
| Migrations | N service DBs | N services × silo tenants |
| Cross-tenant analytics | one query | fan-out |

Pool keeps small/most tenants cheap; silo gives large Govt/PSU/regulated tenants
the physical-separation guarantee they require. This mirrors SAP (public shared
vs RISE single-tenant) and Oracle (VPD pool vs PDB silo).

---

## 2. The keystone — tenant-aware connection routing (BUILT)

`packages/db` now provides `TenantRouter` (+ `envTenantResolver`):

```ts
const router = new TenantRouter();           // resolver defaults to env, pool-only
const sql = await router.sqlFor(tenantId);   // shared pool client OR the tenant's silo client
```

- **pool** tenant → the shared per-service client (lazy, single).
- **silo** tenant → a cached, LRU-capped client to the tenant's dedicated DB.
- Tier/DSN come from a pluggable `TenantResolver`; the default reads
  `TENANT_SILO_IDS` + `TENANT_SILO_DSN_TEMPLATE` (`{tenant}` placeholder) so with
  **no config every tenant is pool — fully backward compatible**.
- In production, back the resolver with the **tenant registry cached in Redis**
  (see §4) instead of env.

Unit-tested without a live DB (injectable client factory): pool sharing, silo
caching, LRU eviction, validation, env resolver. 9 tests green.

---

## 3. Schema & isolation interplay

- **pg schemas are unchanged.** Each service already namespaces its tables
  (`pgSchema("budget")`, `"gl"`, `"files"`, …). A silo tenant's single DB simply
  hosts all those schemas; each service reads/writes only its own.
- **`tenant_id` columns stay** on every row (cheap, and required for pool).
- **RLS:** pool relies on RLS as the primary backstop (keep `FORCE ROW LEVEL
  SECURITY` + `app.tenant_id` GUC via `withTenantScope`). Silo relies on the DB
  boundary; RLS still applies harmlessly (one tenant per DB, predicate always
  true) so the same code path works for both.
- **Cache keys** already include the tenant (`{service}:{tenant}:{resource}:{id}`)
  — no change.

---

## 4. Tenant registry (source of truth)

Add to `tenant-service` (and replicate the read into each service's `public.tenants`
or expose via API + Redis):

```
tenant.isolation_tier   'pool' | 'silo'      (default 'pool')
tenant.db_dsn_ref        secret ref to the silo DB DSN (KMS/secrets manager)
tenant.region            data-residency region (silo)
tenant.kms_key_ref       per-tenant encryption key (silo, BYOK)
```

The production `TenantResolver` reads this (Redis-cached, short TTL) → returns
`{ tier, connectionString }`. DSNs live in a secrets manager, never in env/DB plaintext.

---

## 5. Provisioning a silo tenant (install-service orchestrates)

On `tenant.tenant.created` with `isolation_tier = silo`:
1. Create the tenant database (`civitas_tenant_{id}`) + a least-privilege login
   role (no SUPERUSER, no BYPASSRLS).
2. Run **every service's migrations** into it (all pg schemas), tracking
   per-(tenant, service) migration version; idempotent + resumable.
3. Register the DSN in the secrets manager; set `tenant.isolation_tier = silo`,
   bust the resolver cache.
4. Gate tenant activation until all schemas are migrated (the tenant cannot log
   in mid-provision).

A **migration orchestrator** (cron/CI job) fans out future migrations:
`for each service: apply to shared pool DB + each silo tenant DB`. Must be
idempotent, record per-target version, and alert on partial failure.

---

## 6. Per-service migration from singleton → router (phased)

Each service today has `shared/db.ts`:
```ts
export const sqlClient = createSqlClient(url);
export const db = drizzle(sqlClient, { schema });   // module-level singleton
```
Target:
```ts
const router = new TenantRouter({ resolver: redisBackedResolver });
export async function dbFor(tenantId: string) {
  return drizzle(await router.sqlFor(tenantId), { schema });   // cache drizzle per client
}
```
Call sites change from `db` → `await dbFor(ctx.tenantId)` in routes, consumers,
queries, repos. The **transactional outbox relay** and **SQS consumers** must
resolve the tenant DB per message (the message envelope already carries
`tenantId`). Keep `withTenantScope` for pool RLS.

**Rollout order (lowest blast-radius first):** estab → finance → procurement →
grant → asset → legal → contract → hrms → remaining. Each service ships behind
a flag; with no silo tenants configured, `dbFor` returns the shared client and
behaviour is identical to today.

---

## 7. Financial-data security riders (enabled by silo)

- **Per-tenant encryption keys / BYOK** (silo DB encrypted with the tenant's KMS
  key) — envelope encryption; pool tenants keep platform-managed keys + field
  encryption for PII.
- **Data residency**: place a silo tenant's DB in a specific region/pod.
- **Right-to-erasure (DPDP/GDPR)**: drop the silo DB; pool tenants use scoped delete + crypto-shredding.
- Keep the existing financial controls in BOTH tiers: integer minor units,
  immutable audit, SoD/maker-checker, hash-chained eOffice notings, period close.

---

## 8. Status & next steps

- ✅ **Built:** `TenantRouter` + `envTenantResolver` in `packages/db` (tested, backward compatible).
- ☐ Tenant registry fields + Redis-backed resolver in `tenant-service`.
- ☐ Provisioning orchestration in `install-service` (create DB + migrate all schemas on silo onboarding).
- ☐ Migration orchestrator (fan-out to pool + silo DBs).
- ☐ Per-service `dbFor(tenantId)` rollout (estab first) + outbox/consumer tenant-DB routing.
- ☐ KMS/BYOK + residency wiring for silo tier.

No behaviour change ships until a tenant is explicitly marked `silo` — the
default remains the proven pool model.
