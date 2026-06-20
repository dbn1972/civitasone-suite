# tenant-service

First vertical slice proving the platform's mandatory patterns end-to-end.

## Rules this slice demonstrates

- **L1 — DB per service:** connects only to `civitas_tenant` with the `tenant_svc` login (see `infra/db`). No other service's data is reachable.
- **L2 — module isolation:** the `tenant` module lives in its own `tenant.*` schema under `src/modules/tenant/`; its repo touches only that schema. New modules (`orgunit`, `settings`) get their own schema + folder and never join across.
- **Write via queue (CQRS):** `routes.ts` → `commands.ts` publishes a command to `@civitasone/queue` and returns **202**. It never writes Postgres. `consumer.ts` (run in `worker.ts`) is the only writer — it applies the change + writes the **transactional outbox** in one tx, then the relay publishes the domain + audit events.
- **Read via cache:** `queries.ts` reads through `@civitasone/cache` (`getOrLoad`), hitting Postgres only on a miss. The command primes the cache for read-your-writes.
- **Every mutation audits**, every input is zod-validated, every request carries a `correlationId`, money/ids are opaque, no cross-service FKs.

## Layout

```
src/
├── topics.ts                 command + event names
├── app.ts  index.ts          HTTP (API) — health/ready/metrics + routes
├── worker.ts                 consumers + outbox relay (separate process)
├── shared/  db, infra(cache+queue), outbox, context
└── modules/tenant/
    ├── schema.ts  validators.ts  domain.ts
    ├── repo.ts               reads (query path) + writes (consumer only)
    ├── commands.ts           WRITE PATH → publish + prime cache → 202
    ├── consumer.ts           apply write + outbox + audit (only DB writer)
    └── queries.ts            READ PATH → cache.getOrLoad → repo
```

## Run (dev)

```bash
# 1. bootstrap the database + login (once)
node ../../infra/db/bootstrap/gen_bootstrap.mjs > /tmp/bootstrap.sql && psql "$ADMIN_DATABASE_URL" -f /tmp/bootstrap.sql
psql "$DATABASE_URL" -f migrations/0001_init.sql

# 2. env
export DATABASE_URL=postgres://tenant_svc:***@localhost:5432/civitas_tenant
export REDIS_URL=redis://localhost:6379   # or CACHE_DRIVER=memory
export QUEUE_DRIVER=memory                # or sqs|kafka|rabbit in prod
export JWT_SECRET=dev-secret

# 3. two processes
pnpm dev      # API on :3002
pnpm worker   # consumers + outbox relay

pnpm test     # domain + CQRS-flow tests (no infra needed)
```

## Flow

```
POST /v1/tenants ─auth/zod─► commands.createTenant
   ├─ cache.put(projected)            (read-your-writes)
   ├─ queue.publish(tenant.tenant.create)
   └─ 202 { id, status:"accepted" }
                                   consumer (worker):
                                   BEGIN; insert tenant.tenants + outbox; COMMIT
                                   relay → tenant.tenant.created + audit.event.record
                                   cache.refresh
GET /v1/tenants/:id ─► queries.getTenant ─► cache.getOrLoad ─► (miss) repo.findById
```
