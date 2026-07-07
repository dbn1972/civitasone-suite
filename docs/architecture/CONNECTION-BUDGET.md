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
