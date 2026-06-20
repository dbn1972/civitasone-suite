# Skill — Multi-Tenant Isolation

**When to load:** Every PR. Tenant isolation is the #1 source of catastrophic bugs.

---

## The rule

> No actor sees any data not belonging to their tenant. Ever. Without exception. Except via a tracked, time-bound, dual-approved support-mode escalation that is fully audited.

## Where isolation is enforced (defense in depth)

1. **JWT**: token carries `tid` (tenant id). Identity-service is the only issuer.
2. **Gateway / middleware**: extracts `tid`, sets `app.tenant_id` Postgres session variable.
3. **Application layer**: every Drizzle query filters by `tenantId`. Helper enforces this.
4. **Database layer**: row-level security (RLS) policy on every table:

```sql
ALTER TABLE {service}_{table} ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON {service}_{table}
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

5. **Audit**: any cross-tenant access without `support_mode=true` triggers an SRE alert.

## How a request becomes tenant-scoped

```
HTTP → Gateway extracts JWT → sets correlationId, tenantId, userId, roles in request context
  → Service middleware: SET LOCAL app.tenant_id = '<tid>' inside the request's DB transaction
  → All Drizzle queries inherit the RLS policy
  → Response cannot include any cross-tenant data (RLS blocks at DB)
```

## Helpers (use these, never roll your own)

From `@civitasone/auth`:
```typescript
import { toRequestContext, requireTenant } from "@civitasone/auth";

server.addHook("preHandler", async (req, reply) => {
  const ctx = toRequestContext(await req.jwtVerify(), req.id);
  req.ctx = ctx;
});
```

From `@civitasone/db`:
```typescript
import { withTenant } from "@civitasone/db";

await withTenant(req.ctx.tenantId, async (tx) => {
  // every query inside this block is tenant-scoped via SET LOCAL
});
```

## Cross-tenant operations (rare, never automatic)

- **Platform metrics aggregation** (e.g. total active tenants) — runs in a system service account context with `tid='*'` and only on read-only aggregated counters, never row data
- **Support intervention** — operator elevates to support-mode, dual approval required, time-boxed (≤4h), every action tagged `support_mode=true`
- **Migration / DR** — runs as a job under `service_account` with explicit `tid` per batch, never global

## Common bugs (and how to detect them)

- ❌ `db.select().from(table).where(eq(table.id, id))` — missing tenantId filter
  - ✅ `db.select().from(table).where(and(eq(table.id, id), eq(table.tenantId, ctx.tenantId)))`
  - Best: use `withTenant` helper so RLS handles it

- ❌ Caching a result with a key that does not include tenantId
  - ✅ Cache key always: `{tenantId}:{resource}:{id}` — never `{resource}:{id}`

- ❌ Using a UUID from one tenant's URL to fetch another tenant's record
  - ✅ Always filter by tenantId; never trust that a UUID is "global"

- ❌ Returning a list and forgetting to filter
  - ✅ Drizzle relation queries inherit RLS only when using session var — verify

- ❌ Background job iterating over tenants without isolating context per iteration
  - ✅ Wrap each iteration in `withTenant(t.id, async (tx) => { ... })`

## Testing tenant isolation

Every service MUST have an integration test:

```typescript
it("does not leak data across tenants", async () => {
  const tenantA = await seedTenant();
  const tenantB = await seedTenant();
  const resourceA = await createResourceInTenant(tenantA);

  const response = await request(server)
    .get(`/resource/${resourceA.id}`)
    .set("Authorization", jwtFor(tenantB));

  expect(response.status).toBe(404); // not 403, not 200 with empty body
});
```

This test is mandatory for every new endpoint. CI greps for it.

## Forbidden patterns

- Drizzle query without tenantId filter (when not inside `withTenant`)
- Cache key without tenantId prefix
- Background job without per-iteration tenant context
- Cross-tenant report or analytics in a tenant-facing endpoint
- Service-to-service calls that drop tenantId from the request
- Hardcoded tenant IDs in code (including in tests for fixtures — generate per test)
