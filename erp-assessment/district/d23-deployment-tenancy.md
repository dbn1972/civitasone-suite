# D23 — Deployment, Tenancy, and Cell Model

**Lane:** L08 · **Date:** 2026-07-13  
**Role:** Platform Engineer + SRE/DR Expert  
**Source branch:** `court-management-service` · repo `/tmp/cms-wt`

> **Prerequisites:** `d16-district-federation-model.md` (federation model), `d21-target-architecture.md` (principles + gaps), `08-tenant-isolation-report.md` (tenant isolation 7/10), `d15-security-domain-matrix.md` (domain isolation). This document covers the deployment substrate and SRE/DR model for those architectural choices.

---

## 1. Current Reality Baseline [VERIFIED]

| Dimension | Current State | Evidence |
|---|---|---|
| PostgreSQL | Single `civitasone-postgres` Docker container; 39 databases on one host | `docker exec civitasone-postgres psql -U civitas_admin -c "\l"` → 39 rows |
| Redis | Single `civitasone-redis:6379` container; `appendonly yes`; no Sentinel, no Cluster | `infra/docker-compose.yml: redis: command: ["redis-server", "--appendonly", "yes"]` |
| S3/MinIO | Single bucket `"civitasone"` for all services | `packages/storage/src/index.ts:56` — `AWS_S3_BUCKET = "civitasone"` |
| Meilisearch | Single shared instance; one `MEILI_URL` | `packages/search` → single env var |
| Keycloak | Single container `civitasone-keycloak`; one realm `civitasone` | `infra/docker-compose.yml` |
| Backup / PITR | **NONE** — no WAL archiving, no pg_dump scheduled, no RDS, no snapshot policy | `infra/aws/envs/production/main.tf:12-15` — `module "rds"` is commented out; no backup module |
| Silo tenant DB | One specimen: `civitas_tenant_0a0a0a0a11112222` (test silo provision) | Live `\l` output — silo provisioning works at DB-creation level |
| Cell registry | **ABSENT** — no `install.cells` table, no placement engine | Grep: no `cells` table in any schema |
| Tenant-router wiring | **ABSENT** — services use module-level `DATABASE_URL` singleton, not `router.sqlFor(tenantId)` | `d02-current-architecture.md §2`; `d15-security-domain-matrix.md §B.2` |
| infra/aws modules | Only SQS module provisioned; ALB, ECS, RDS, ElastiCache all commented out | `infra/aws/envs/production/main.tf:12-15` |
| RPO (current) | **Effectively unbounded** — no backup exists; a postgres container failure = total data loss | [VERIFIED: no backup config anywhere] |
| RTO (current) | **Undefined** — no DR playbook, no failover tested | [VERIFIED: no DR infrastructure] |

---

## 2. Cell Architecture: Specification

### Cell Type 1 — State Control Plane Cell

| Attribute | Specification |
|---|---|
| **Count** | 1 per state (28 states + 8 UTs = ~36 cells nationally) |
| **Purpose** | Hosts state-level registries, master data, control-plane services; parent of all district cells in the state |
| **Services** | tenant-service, install-service, admin-service, policy-service, audit-service, location-service, analytics-service (state roll-up), gateway-service, Keycloak (state realm) |
| **Tenants** | 1 state control-plane tenant + up to 20 state-level department tenants (State Finance Dept, State Health Dept, etc.) |
| **Max offices** | 500 (state department offices, directorates) |
| **Max users** | 5,000 (state-level officers) |
| **DB** | Dedicated RDS PostgreSQL 16 Multi-AZ cluster; 38 databases (one per service schema); `civitas_*_state` prefix convention |
| **Redis** | ElastiCache Redis 7 cluster mode; 2 shards, 1 replica each |
| **S3** | Dedicated bucket `civitasone-{stateCode}-control` with bucket-level encryption (SSE-KMS) |
| **Meilisearch** | Dedicated instance (small: 2 vCPU, 4 GB RAM) |
| **KMS** | State-level CMK per service (not shared with district cells) |
| **Failure domain** | Independent from district cells; state cell failure does not break existing district operations (district cells cache policy/token validation locally with 30s TTL) |
| **RTO** | **2 hours** (RDS Multi-AZ automatic failover ~60–120s; ECS service recovery ~5 min; Keycloak HA recovery < 5 min) |
| **RPO** | **1 hour** (RDS automated backups + WAL archiving to S3; transaction logs every 5 min for PITR) |
| **Scaling rule** | Scale state-level services horizontally (ECS tasks ×2–×4) during elections or budget season; RDS read-replica for analytics workloads |
| **Tenant migration** | Not applicable — state cell is pinned; district tenant provisioning is idempotent |
| **Backup** | RDS automated backup (daily snapshot + continuous WAL); cross-region S3 replication to DR region; 7-year retention for audit |

---

### Cell Type 2 — Shared District Cell

| Attribute | Specification |
|---|---|
| **Count** | ~6–8 per state (100 districts ÷ 12–15 districts per cell) |
| **Purpose** | Hosts 8–15 districts; each district has 6–8 pool-tier department tenants (Collectorate, Revenue, Health, Education, RD, Urban, Coordination) |
| **Services** | All 37 application services; gateway-service; Keycloak (district realm, federated to state Keycloak IdP) |
| **Max tenants** | 1,200 (15 districts × 8 dept tenants per district) |
| **Max offices** | 15,000 (offices across all districts in this cell) |
| **Max users** | 150,000 (officers + staff across 15 districts; district avg ~10,000 users) |
| **DB** | Dedicated RDS PostgreSQL 16 Multi-AZ; 37 per-service DBs; all pool-tier tenants co-exist via RLS; `civitas_*` prefix |
| **Redis** | ElastiCache Redis 7 cluster mode; 4 shards, 1 replica each; key namespace: `{svc}:{tenantId}:{resource}:{id}` |
| **S3** | Dedicated bucket `civitasone-{stateCode}-shared-{n}` (e.g. `civitasone-mh-shared-1`); per-tenant object key prefix `{tenantId}/...`; SSE-S3 default, SSE-KMS on sensitive prefixes |
| **Meilisearch** | Dedicated instance (medium: 4 vCPU, 8 GB RAM); per-tenant index prefix `{tenantId}_*` |
| **KMS** | Shared state-managed key for pool tenants (acceptable — pool tier is not classified); OR per-tenant key if `kmsKeyRef` is set (P1 build) |
| **Failure domain** | Failure of Shared District Cell affects 10–15 districts simultaneously — highest blast-radius in the architecture |
| **RTO** | **4 hours** (RDS Multi-AZ failover + ECS recovery + Keycloak recovery + DNS propagation) |
| **RPO** | **2 hours** (RDS automated backups + WAL archiving; continuous PITR; RTO/RPO acceptable for non-critical district operations) |
| **Scaling rule** | Scale horizontally (ECS task count) during peak census/election events; add RDS read-replicas for analytics queries; Redis node count up on throughput alarm |
| **Tenant migration rule** | When a tenant's daily active users > 10,000 or storage > 1 TB → trigger promotion to Large District Dedicated Cell (pool→pool move, no tier change) |
| **Backup** | RDS daily automated snapshot; WAL to S3 (10-min granularity PITR); cross-AZ replicas; 7-year retention (GFR compliance) |
| **Monitoring** | Prometheus/Grafana per cell; alerting on: tenant RLS GUC miss (fail-closed = 0 rows = operational alert), Redis key eviction, SQS DLQ depth > 0 |

---

### Cell Type 3 — Large District Dedicated Cell

| Attribute | Specification |
|---|---|
| **Count** | ~5–10 per state (metro/large districts: Mumbai, Delhi, Hyderabad, Bengaluru, Jaipur, etc.) |
| **Purpose** | Single large district in a dedicated cell; same pool-tier tenants but no resource contention with other districts |
| **Tenants** | 1 district × 8 dept tenants = 8 pool-tier tenants |
| **Max offices** | 3,000 |
| **Max users** | 50,000 |
| **DB** | RDS PostgreSQL 16 Multi-AZ; same 37-DB structure; pool tier |
| **Redis** | ElastiCache Redis 7 cluster mode; 2 shards, 1 replica |
| **S3** | Dedicated bucket `civitasone-{stateCode}-{districtCode}` |
| **KMS** | Same as Shared Cell (pool tier) |
| **Failure domain** | Failure affects one district; RPO/RTO acceptable |
| **RTO** | **2 hours** |
| **RPO** | **1 hour** |
| **Scaling rule** | Vertical scale first (RDS instance class); horizontal ECS tasks on CPU alarm |
| **Tenant migration rule** | If district expands to >50K users → upgrade RDS instance class; no migration needed |
| **Backup** | Same as Shared Cell |

---

### Cell Type 4 — Police Dedicated Cell

| Attribute | Specification |
|---|---|
| **Count** | 1 per state (Police Headquaters / DGP manages all district police in one cell) |
| **Purpose** | All district-police tenants (one silo tenant per district) on dedicated, CERT-In compliant infrastructure; no civilian service data co-resides |
| **Services** | hrms-service, payroll-service, court-service (civil; NOT CCTNS/FIR — those integrate via CCTNS adapter), workflow-service, notification-service, gateway-service; Keycloak (police realm, federated to state Keycloak IdP) |
| **Tenants** | 1 silo tenant per district police = 640 tenants nationally (one per district) |
| **Max offices** | 50,000 (all police stations + circles + districts nationally, managed per state) |
| **Max users** | 500,000 per state (all police officers, constabulary) |
| **DB** | **Dedicated RDS PostgreSQL 16 Multi-AZ cluster** (`civitas_police_*` DBs); `isolationTier: 'silo'`; each district-police tenant in its own schema/DB; `dbDsnRef` → Vault `/police-cell/{stateCode}/pg-dsn`; zero cross-domain table access |
| **Redis** | **Dedicated ElastiCache Redis 7 cluster** (`civitas-police-redis`); no shared keyspace with civilian domains |
| **S3** | **Dedicated S3 bucket** `civitasone-{stateCode}-police`; bucket policy: `DenyAllExcept[police_svc_role]`; cross-region replication to DR |
| **Meilisearch** | Dedicated instance; per-district-tenant index namespace |
| **KMS** | **Per-cell CMK** (AWS KMS `civitas-police-{stateCode}`); used as the `kmsKeyRef` for all police silo tenants; police officers' PII (Aadhaar, PAN, biometric refs) encrypted with this key |
| **Network** | Restricted VPC security group: inbound only from police gateway, state control-plane, and DGP admin IP ranges; NO inbound from civilian gateway or public internet |
| **CCTNS Integration** | Read-only CCTNS adapter stub [P1 to build: `packages/gov-adapters/cctns.ts`]; never duplicates FIR/investigation data; queries CCTNS ICJS API for case status references in court-service |
| **Failure domain** | Police cell failure = police operations fall back to offline mode (paper registers); does NOT affect civilian district operations |
| **RTO** | **1 hour** (RDS Multi-AZ failover + ECS recovery; police operational continuity requires tighter RTO) |
| **RPO** | **30 minutes** (WAL archiving every 5 min; 30-min recovery point; CERT-In ISCP requirement for law enforcement data) |
| **Scaling rule** | Scale ECS tasks horizontally during elections (duty rosters) or special events; no tenant migration (all police are on this cell by design) |
| **Backup** | RDS automated backup (daily) + WAL archiving (5-min granularity); **offline encrypted copy** on tape/cold storage monthly (CERT-In §9 requirement for law enforcement); 30-year retention for establishment records |
| **Audit** | All access to police cell logs to `audit-service` (on State Control Plane Cell); break-glass access triggers immediate SRE alert |

---

### Cell Type 5 — Treasury Dedicated Cell

| Attribute | Specification |
|---|---|
| **Count** | 1 per state |
| **Purpose** | All district-treasury/finance tenants; dedicated infrastructure for government financial data; CAG audit compliance |
| **Services** | finance-service, procurement-service, payroll-service (govt salary), audit-service (local replica for CAG), report-service, gateway-service; Keycloak (treasury realm) |
| **Tenants** | 1 silo tenant per district = ~640 per state |
| **Max offices** | 20,000 (DDOs, PAOs, Treasury offices) |
| **Max users** | 200,000 per state (DDO officers, finance staff, audit teams) |
| **DB** | **Dedicated RDS PostgreSQL 16 Multi-AZ** (`civitas_finance_*`); `isolationTier: 'silo'`; `dbDsnRef` → Vault `/treasury-cell/{stateCode}/pg-dsn`; **7-year WAL retention** (GFR / CAG requirement); archival storage for vouchers beyond 7 years |
| **Redis** | Dedicated ElastiCache Redis 7 cluster; no civilian key mixing |
| **S3** | Dedicated bucket `civitasone-{stateCode}-finance`; **WORM policy** (Object Lock) for audit vouchers; CAG export path `audit/{year}/...` |
| **KMS** | Per-cell CMK (`civitas-finance-{stateCode}`); MFA delete required for key rotation; `kmsKeyRef` on all treasury silo tenants |
| **Network** | Inbound only from treasury gateway, PFMS VPN, NACH settlement IP, Keycloak; DDO approve/disburse routes require MFA (TOTP) in addition to JWT |
| **PFMS Integration** | `packages/gov-adapters/pfms.ts` [VERIFIED PRESENT]; outbound mTLS to PFMS state node; inbound reconciliation events |
| **Failure domain** | Treasury cell failure = payment disbursement suspended; salary processing delayed; does NOT affect civilian district operations |
| **RTO** | **1 hour** (salary/payment SLA requires tight RTO; month-end payroll run cannot be lost) |
| **RPO** | **15 minutes** (WAL archiving every 1 min; financial records must be consistent to last committed transaction) |
| **Scaling rule** | Vertical scale RDS on month-end payroll runs; ECS task scale-out for quarterly budget processing |
| **Backup** | RDS automated backup (daily) + continuous WAL archiving; cross-region replication; **immutable S3 Object Lock** for financial vouchers; 7-year online PITR + 30-year archival |
| **Audit** | DDO-level audit trail to local `audit-service`; CAG report extraction via `report-service` → S3 audit path → CAG portal |

---

### Cell Type 6 — Ministry Integration Cell

| Attribute | Specification |
|---|---|
| **Count** | 1 nationally (cloud-hosted, central government) |
| **Purpose** | Receives aggregated (non-PII) event streams from all state control planes; national analytics; ministry dashboard |
| **Services** | analytics-service (national aggregation), audit-service (national compliance), gateway-service (ministry-facing API), report-service |
| **Tenants** | 1 per ministry (MHA, MoF, MoHFW, MoE, MoRD, MoUD, MoPR) = ~15 tenants |
| **Max users** | 5,000 (ministry officers, secretariat staff) |
| **DB** | RDS PostgreSQL 16; analytics facts tables only; no PII from district data |
| **Redis** | ElastiCache Redis 7 (small) |
| **S3** | S3 bucket for national reports and data exports |
| **Failure domain** | Ministry cell failure = national dashboard unavailable; district operations are unaffected (district cells are fully autonomous) |
| **RTO** | **8 hours** (analytics is not mission-critical; daily reconciliation acceptable) |
| **RPO** | **4 hours** (aggregated facts, no raw PII; some data loss acceptable) |
| **Scaling rule** | Auto-scale analytics workers for end-of-year national reporting |
| **Backup** | S3 cross-region; RDS automated backup; 2-year online retention |

---

## 3. Cell Capacity Summary

| Cell Type | Count (MH example state) | Max Tenants | Max Users | DB | Redis | RTO | RPO |
|---|---|---|---|---|---|---|---|
| State Control Plane | 1 | 20 | 5,000 | Dedicated RDS Multi-AZ | ElastiCache cluster | 2h | 1h |
| Shared District Cell | 3 (MH has 36 dists, 3 cells × 12 dists) | 1,200 | 150,000 | Dedicated RDS Multi-AZ | ElastiCache cluster | 4h | 2h |
| Large District Dedicated | 2 (Mumbai Suburban, Pune) | 8 | 50,000 | Dedicated RDS Multi-AZ | ElastiCache cluster | 2h | 1h |
| Police Dedicated | 1 (per state) | 36 (one per district) | 500,000 | Dedicated RDS Multi-AZ | Dedicated ElastiCache | 1h | 30min |
| Treasury Dedicated | 1 (per state) | 36 | 200,000 | Dedicated RDS Multi-AZ | Dedicated ElastiCache | 1h | 15min |
| Ministry Integration | 1 (national) | 15 | 5,000 | RDS (analytics) | ElastiCache (small) | 8h | 4h |

---

## 4. Backup / PITR Gap — Critical P0 Finding

### 4.1 Current State [VERIFIED]

**There is no backup or PITR configured anywhere in this system.**

Evidence:
- `infra/aws/envs/production/main.tf:12-15` — `module "rds"`, `module "ecs"`, `module "elasticache"` are ALL commented out. No RDS resource = no automated RDS backup.
- No `pg_dump` cron job found anywhere in `infra/`.
- No WAL archiving config (`archive_mode`, `archive_command`) found in any postgres config file.
- The only postgres instance is a Docker container (`civitasone-postgres`) with a named volume `redisdata` — a volume, not a managed DB service.
- `infra/observability/` contains Loki + Prometheus configs but no backup monitoring.

**Consequence:** RPO = unbounded. A single `docker volume rm redisdata` or host failure destroys all production data from all 36 services. This is a **P0 disqualifier** for any district pilot.

### 4.2 Target Backup Architecture (Per Cell)

```
PostgreSQL (RDS Multi-AZ)
  ├── Automated daily snapshots → S3 (encrypted, SSE-KMS)
  ├── WAL archiving: pgBackRest → S3 (continuous, 1–5 min granularity)
  │    ├── Shared District Cell: 10-min granularity → RPO 2h
  │    ├── Police Cell: 5-min granularity → RPO 30min
  │    └── Treasury Cell: 1-min granularity → RPO 15min
  ├── Cross-AZ standby (Multi-AZ automatic failover, ~60s)
  └── Cross-region replica for DR (async, ≤5 min lag)

Redis (ElastiCache)
  ├── AOF persistence (appendonly yes — already in dev config)
  └── Daily RDB snapshot to S3

S3
  ├── Versioning enabled per bucket
  ├── Cross-region replication (S3 CRR) to DR region
  └── Object Lock (WORM) on Treasury and Audit buckets
```

### 4.3 Immediate P0 Remediation Steps

1. **Uncomment RDS module** in `infra/aws/envs/production/main.tf` and configure:
   ```hcl
   module "rds" {
     source                      = "../../modules/rds"
     backup_retention_period     = 35         # 35 days PITR window
     deletion_protection         = true
     multi_az                    = true
     performance_insights_enabled = true
     storage_encrypted           = true
     kms_key_id                  = var.rds_kms_key_id
   }
   ```
2. **WAL archiving:** Configure `archive_mode = on` and `archive_command` to pgBackRest pushing to S3.
3. **Backup monitoring:** Alert if `last_successful_backup_age > 1h` (Treasury/Police) or `> 6h` (Shared District).
4. **Recovery test:** Monthly automated PITR restoration test to isolated environment; result logged to audit-service.
5. **RTO testing:** Quarterly DR failover drill; failure domain verified per cell type.

---

## 5. Tenant Isolation Tier Migration (Pool → Silo)

When a pool-tier department tenant is promoted to a silo cell (e.g., a district's Police tenant being moved from Shared Cell to Police Dedicated Cell):

```
Phase 1 — Provision (install-service)
  install.cells INSERT (Police Dedicated Cell for this state)
  install.tenant_cell_placements INSERT (tenantId → new cell)
  tenant.tenants UPDATE: isolationTier = 'silo', dbDsnRef = vault://..., kmsKeyRef = vault://...

Phase 2 — Data Movement (install-service, NEW wizard stage)
  For each service DB:
    1. pg_dump (source pool DB) → encrypted S3 staging
    2. pg_restore (silo DB) — with tenant_id filter
    3. Verify row counts match
    4. Enable dual-write mode: writes go to both pool and silo
    5. Replay inflight outbox messages

Phase 3 — Cutover (zero-downtime)
  6. SET app.tenant_id on silo DB = migration complete
  7. Update tenant-router cachedResolver: tenant → silo tier (TTL invalidation)
  8. Disable pool writes for this tenant
  9. Monitor: RLS probe (pool returns 0 rows for this tenant — correct)

Phase 4 — Cleanup
  10. After 30-day observation: DELETE pool data for tenant (with audit log)
```

**Gap:** Steps 2–9 are entirely absent today. `provision-silo-tenant.mjs` creates an EMPTY silo DB only; there is no data copy pipeline. [VERIFIED: `install-service/src/modules/provisioning/schema.ts` — `steps: jsonb` is the wizard step tracker; no migration step type exists].

---

## 6. Queue Architecture Per Cell

### Current State [VERIFIED]
Single SQS queue set (local: LocalStack; prod: `infra/aws/envs/production/main.tf` SQS module); all tenant messages share queues differentiated only by `MessageGroupId=tenantId` FIFO ordering.

### Target: Per-Cell Queue Isolation

| Cell | Queue Naming | Isolation |
|---|---|---|
| State Control Plane | `civitas-state-{stateCode}-{topic}` | Fully separate SQS queues |
| Shared District Cell | `civitas-shared-{cellId}-{topic}` | Separate per cell |
| Police Dedicated | `civitas-police-{stateCode}-{topic}` | Dedicated; no civilian topics |
| Treasury Dedicated | `civitas-treasury-{stateCode}-{topic}` | Dedicated; PFMS-aligned naming |
| Ministry Integration | `civitas-ministry-{topic}` | National aggregation topics only |

**Cross-cell events** (e.g., coordination alerts) route through the State Control Plane Cell's event router:
- Source domain cell → publishes to its local `coordination.alert.issued` queue
- State Control Plane event router consumes → fans out to target domain cells

### Queue Fairness Gap [VERIFIED ABSENT]
No per-tenant queue depth limiting; a single chatty tenant can starve other tenants in the same FIFO queue (all share one FIFO stream; `MessageGroupId=tenantId` only prevents ordering violations between messages of the same group, not starvation across groups). **P1:** Implement per-tenant quota enforcement at the queue layer.

---

## 7. DR Playbook Summary (per cell)

| Scenario | Cell | Action | RTO Target |
|---|---|---|---|
| AZ failure | Any | RDS Multi-AZ automatic failover; ECS tasks reschedule on healthy AZ | < 5 min |
| PG host failure | Any | RDS Multi-AZ; reconnect via same endpoint (DNS flip by RDS) | < 2 min |
| Redis failure | Any | ElastiCache cluster: replica promotion; service retry (idempotent consumers) | < 2 min |
| Cell region failure | Shared District / Large District | Failover to cross-region RDS replica (manual promote) + ECS deploy in DR region | 4h |
| Cell region failure | Police / Treasury | Failover to cross-region RDS replica (manual promote); DGP/Finance Controller notified | 1h |
| Data corruption (logical) | Any | PITR restore to point before corruption; replay outbox from WAL | 2–4h |
| Total cell loss | Shared District | Restore from cross-region backup; redeploy ECS stack; replay from WAL | 4–8h |
| Keycloak realm failure | Any district cell | State Keycloak failover (Multi-AZ); district cell tokens cached 30s in Redis | < 5 min |

---

## 8. Priority Roadmap

| Gap | Priority | Estimated Effort | Blocking For |
|---|---|---|---|
| **Backup/PITR: uncomment RDS module, enable WAL archiving** | **P0** | 1 sprint (2 weeks) | Any district pilot |
| **Cell registry DDL + install-service APIs** (`install.cells` + `install.tenant_cell_placements`) | **P0** | 1 sprint | Silo provisioning |
| **Tenant-router wiring in all services** | **P0** | 2 sprints (depends on service count) | Silo routing |
| **Module-guard wiring in gateway** | **P0** | < 1 day | Per-tenant module control |
| **Federation column migration** (tenant table: lgd codes, department_code, cell_id) | **P0** | 2 days | Tenant-to-cell placement |
| **Pool → silo data migration pipeline** (new install wizard stage) | **P1** | 3 sprints | Police/Treasury promotion |
| **Police Dedicated Cell provisioning** (Terraform + Keycloak realm) | **P1** | 2 sprints | Police pilot |
| **Treasury Dedicated Cell provisioning** | **P1** | 2 sprints | Treasury pilot |
| **Per-domain KMS CMK** (wire kmsKeyRef into pii-crypto key derivation) | **P1** | 1 sprint | Police CERT-In compliance |
| **Per-cell queue naming + cross-cell event router** | **P2** | 2 sprints | Multi-cell deployment |
| **Queue fairness per tenant** | **P1** | 1 sprint | Shared cell stability |
| **DR drill automation** (monthly automated PITR test) | **P1** | 1 sprint | Production readiness |
| **Ministry integration cell** + cross-state analytics | **P3** | 4 sprints | State rollout complete |
