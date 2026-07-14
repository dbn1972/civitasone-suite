# Database Connection Budget

## Problem (C2)

33 services × default pool_max=10 × 1 pod = 330 connections > PostgreSQL max_connections=200.
PgBouncer is provisioned (port 6432, transaction mode) but bypassed — all services connect directly to port 5432.

## Solution

Route all service DSNs through PgBouncer (:6432). The `packages/db` pool.ts already detects `DB_VIA_PGBOUNCER=true` and adjusts:
- Sets `prepare: false` (required for transaction-mode pgbouncer)
- Reduces default pool max from 10 to 5

## Connection Budget

| Layer | Budget |
|-------|--------|
| PostgreSQL `max_connections` | 200 (configurable) |
| PgBouncer `default_pool_size` (server-side per-db) | 20 |
| PgBouncer `max_client_conn` (client-side total) | 500 |
| Per-service pool max (via pgbouncer) | 5 |
| 33 services × 1 pod × 5 connections | 165 client connections |
| 33 services × 2 pods × 5 connections (scaled) | 330 client connections |

### Constraint

```
services × pods × pool_max ≤ pgbouncer max_client_conn ≤ pgbouncer connections to PG ≤ max_connections
```

With pgbouncer in transaction mode:
- Client connections (500) can exceed server connections (20 per-db pool)
- PgBouncer multiplexes: a client holds a server connection only during a transaction
- At steady state: ~20 concurrent transactions across all services is the server-side limit per-database

### Configuration

Each service must set:
```env
DATABASE_URL=postgres://<svc>_svc:<password>@pgbouncer:6432/<db_name>
DB_VIA_PGBOUNCER=true
DB_POOL_MAX=5
```

The `packages/db/pool.ts` auto-detects pgbouncer via:
- `DB_VIA_PGBOUNCER=true` env var
- Port 6432 in the URL
- "pgbouncer" in the URL

When detected:
- `prepare: false` (pgbouncer transaction mode doesn't support prepared statements)
- `max: 5` (default, overridable via DB_POOL_MAX)

## Verification

The `tests/security/connection-budget.test.ts` asserts:
- Total pool budget across all services stays under max_connections
- Each service pool max is correctly sized

## Read Replica

A read replica offloads pool-tier read traffic from the primary. AWS provisions one via Terraform; on-prem uses PostgreSQL streaming replication through the Helm chart's bundled `postgresql` sub-chart. Both expose their endpoint through the same `DATABASE_REPLICA_URL` convention, consumed opt-in by `packages/db`'s `dbForRead()`.

### AWS

`infra/aws/modules/rds-replica/main.tf` provisions `aws_db_instance.replica` with `replicate_source_db = var.primary_db_identifier` and `publicly_accessible = false`, wired into `infra/aws/envs/production/main.tf` as `module "rds_replica"`. Its `replica_endpoint` output (the replica's `address`) is populated into the secrets manager as `DATABASE_REPLICA_URL`.

### On-prem (streaming replication via the `postgresql` sub-chart)

`infra/onprem/helm/civitasone/values.yaml` already carries a `postgresql:` values block (`enabled: true`, `auth.username`/`auth.database`) that `templates/pgbouncer.yaml` targets by convention — it resolves its upstream host to `{{ .Release.Name }}-postgresql` whenever `pgbouncer.databaseHost` is left empty. This is the Bitnami-style `postgresql` sub-chart naming convention. As of this chart version, `Chart.yaml` does not yet declare a `dependencies:` entry pinning that sub-chart (no `charts/` vendor directory or `Chart.lock`) — the `postgresql:` values block is the forward-compatible convention other templates already key off, and adding the dependency entry (e.g. `oci://registry-1.docker.io/bitnamicharts/postgresql`, pinned exact version) is what activates it.

Once that dependency is declared, a streaming-replication read replica is configured entirely through the sub-chart's own values, nested under the chart's `postgresql:` key:

```yaml
postgresql:
  enabled: true
  auth:
    username: civitasone
    database: civitasone
  architecture: replication      # NEW — primary + N read replicas via streaming replication
  readReplicas:
    replicaCount: 1               # NEW — one streaming-replication standby
```

This is a single `postgresql` release (not a second Helm release) whose `architecture: replication` mode makes the sub-chart deploy both a primary StatefulSet and a `readReplicas.replicaCount`-sized set of standby StatefulSets that stream-replicate from it. The sub-chart renders a separate read Service alongside the existing primary Service:

| Service | DNS name | Role |
|---------|----------|------|
| Primary | `{{ .Release.Name }}-postgresql` | Read/write — what `pgbouncer.yaml` targets today |
| Read replica | `{{ .Release.Name }}-postgresql-read` | Read-only — streaming-replication standby |

### `DATABASE_REPLICA_URL` population convention

| Environment | Source | Value populated |
|-------------|--------|-----------------|
| AWS | `module.rds_replica.replica_endpoint` (Terraform output) | `postgres://<user>:<password>@<replica_endpoint>:5432/<db_name>` written into the secrets manager entry each service's `DATABASE_REPLICA_URL` env var resolves from |
| On-prem | The `postgresql` sub-chart's read Service, `{{ .Release.Name }}-postgresql-read` | `postgres://<user>:<password>@<release>-postgresql-read:5432/<db_name>` — same release-name templating convention `pgbouncer.yaml` already uses for the primary host |

`DATABASE_REPLICA_URL` is a distinct env var from `DATABASE_URL` — it is never routed through the Connection_Proxy (pgbouncer) and is only read by the opt-in `dbForRead()` accessor, not by `db`/`sqlClient`/`dbFor`.

### Consumption via `dbForRead()`

`packages/db`'s `createTenantDb()` adds a `dbForRead(tenantId)` export alongside `dbFor`:

1. Resolve the tenant's tier via the same `TenantRouter` used by `dbFor` (an unresolvable tier rejects the request — it never returns a connection).
2. If `DATABASE_REPLICA_URL` is unset, or the tenant's tier is `silo`/`shard`, return the primary connection unchanged — replicas only ever serve pool-tier reads in v1.
3. Otherwise, probe the cached replica client with `SELECT 1`; on success, return a `drizzle` instance bound to the replica. On any failure (including no replica ever having been configured), log exactly one WARN and fall back to the primary — `dbForRead()` never throws for a missing/unreachable replica.

Because `dbForRead` is additive, every existing call site using `db`/`sqlClient`/`dbFor` is unaffected whether or not `DATABASE_REPLICA_URL` is set.
