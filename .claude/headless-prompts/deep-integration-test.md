# CivitasOne Deep Integration & Functionality Test

## Infrastructure (ALREADY RUNNING — DO NOT CREATE DOCKER)

| Service | Host | Port | Credentials |
|---------|------|------|-------------|
| PostgreSQL 16 | localhost | 5435 | user: `civitas_admin` / password: `civitas_dev_pw` |
| PgBouncer | localhost | 6432 | (pools from above) |
| Redis 7 | localhost | 6381 | no auth |
| LocalStack (SQS, S3) | localhost | 4566 | region: us-east-1 |
| Keycloak 24 | localhost | 8180 | admin/admin |

**35 databases already exist** (civitas_hrms, civitas_finance, civitas_notification, etc.)

## Working Directory
```
/home/ec2-user/CivitasOne/civitasone-suite
```

## Auth (HS256 Test Bypass — no Keycloak needed for tests)
```typescript
import { signToken } from "@civitasone/auth";
const SECRET = "test_secret_for_civitasone_32chr";

// Generate token for any role/tenant
function token(tenantId: string, actorId: string, roles: string[]) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: `sess-${Date.now()}` }, SECRET);
}
```

## Test Execution Instructions

### Phase 1: Run ALL existing tests (verify baseline)
```bash
cd /home/ec2-user/CivitasOne/civitasone-suite

# Run per-service (faster, parallel-safe)
for svc in $(ls services/); do
  pnpm --filter @civitasone/$svc exec vitest run 2>&1 | grep "Tests" >> /tmp/test-results.txt
done

# Report results
cat /tmp/test-results.txt
```

### Phase 2: Deep Integration Tests (NEW — write and execute these)

For EACH of the 41 services, write a NEW test file `tests/deep-integration.test.ts` that:

1. **Seeds real data** into PostgreSQL (INSERT via the service's Drizzle DB client)
2. **Executes the full CQRS write path**: POST → queue.publish → consumer processes → DB write → cache invalidate
3. **Verifies the read path**: GET → cache.getOrLoad → returns seeded data
4. **Verifies tenant isolation**: Token for tenant-A, data for tenant-B → must return empty/404
5. **Verifies auth**: No token → 401, wrong role → 403
6. **Verifies idempotency**: Same messageId processed twice → no duplicate row
7. **Verifies audit trail**: After mutation → audit event exists in outbox

### Phase 3: Cross-Service Choreography Tests

Write `tests/cross-service/` integration tests that verify:

1. **Leave Flow**: hrms leave.apply → notification.send event emitted
2. **Payment Flow**: finance bill.create → procurement 3-way-match
3. **Citizen Request**: citizen.request.create → helpdesk ticket auto-created
4. **Contract Expiry**: contract expiry-detect → notification alert
5. **Audit Trail**: ANY service mutation → audit.event.record in outbox

### Phase 4: Data Integrity Tests

1. **Double-entry verification**: For every GL voucher, SUM(debits) = SUM(credits)
2. **Money precision**: All amounts stored as bigint — verify no floating point
3. **Optimistic locking**: Two concurrent updates to same entity → one gets 409
4. **RLS enforcement**: Direct SQL query without app.tenant_id GUC → returns 0 rows
5. **PII encryption**: SELECT aadhaar column from DB → value is ciphertext, not plaintext

### Phase 5: Performance Verification

For the top 10 highest-traffic routes:
1. Call each route 100 times in a loop
2. Measure: min, p50, p95, p99, max response time
3. Assert: p95 < 200ms for reads, p95 < 500ms for writes
4. Assert: zero 5xx errors in the batch

## Service Ports (for HTTP testing if services are started)

| Service | Port | Prefix |
|---------|------|--------|
| identity | 3001 | /api/identity |
| tenant | 3002 | /api/v1/tenants |
| policy | 3003 | /api/v1/policy |
| audit | 3004 | /api/v1/audit |
| install | 3005 | /api/v1/install |
| notification | 3006 | /api/notification |
| finance | 3007 | /api/v1/finance |
| procurement | 3008 | /api/v1/procurement |
| contract | 3009 | /api/v1/contract |
| estab | 3010 | /api/v1/estab |
| stock | 3011 | /api/v1/stock |
| hrms | 3012 | /api/v1/hrms |
| payroll | 3013 | /api/v1/payroll |
| project | 3014 | /api/v1/projects |
| asset | 3015 | /api/v1/assets |
| report | 3016 | /api/v1/reports |
| plugin | 3017 | /api/v1/plugins |
| theme | 3018 | /api/v1/themes |
| grant | 3019 | /api/v1/grants |
| citizen | 3020 | /api/v1/citizen |
| legal | 3021 | /api/v1/legal |
| admin | 3022 | /api/v1/admin |
| billing | 3023 | /api/v1/billing |
| crm | 3024 | /api/v1/crm |
| inventory | 3025 | /api/v1/inventory |
| telephony | 3026 | /api/v1/telephony |
| helpdesk | 3027 | /api/v1/helpdesk |
| knowledge | 3028 | /api/v1/knowledge |
| workflow | 3029 | /api/v1/workflow |
| queue | 3030 | /api/v1/queue |
| analytics | 3031 | /api/v1/analytics |
| location | 4012 | /api/v1/locations |
| gateway | 8080 | — (entry point) |
| court | 3034 | /api/v1/court |
| meeting | 3033 | /api/v1/meeting |
| visitor | 3035 | /api/v1/visitor |

**NOTE:** For integration tests, use `app.inject()` (in-memory Fastify) — no need to start services on ports. Only use HTTP ports if testing the gateway proxy layer.

## Test Pattern (copy for each service)

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();

const tokenA = signToken({ sub: ACTOR, tid: TENANT_A, roles: ["super_admin"], sid: "s1" }, SECRET);
const tokenB = signToken({ sub: ACTOR, tid: TENANT_B, roles: ["super_admin"], sid: "s2" }, SECRET);

afterAll(async () => { await sqlClient.end(); });

describe("deep integration", () => {
  it("write + read cycle works", async () => {
    const app = await buildApp();
    // POST (write)
    const writeRes = await app.inject({
      method: "POST", url: "/v1/...",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { /* valid body */ },
    });
    expect([200, 201, 202]).toContain(writeRes.statusCode);
    
    // GET (read) — may need consumer to process first
    const readRes = await app.inject({
      method: "GET", url: "/v1/...",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(readRes.statusCode).toBe(200);
    
    // Tenant isolation
    const isolationRes = await app.inject({
      method: "GET", url: "/v1/...",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(isolationRes.json().data).toHaveLength(0);
    
    await app.close();
  });

  it("401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/..." });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
```

## Success Criteria

- **ALL 14,676+ existing tests pass** (baseline)
- **NEW integration tests**: 5+ per service = 200+ additional tests
- **Zero tenant isolation violations**
- **Zero unhandled 500 errors**
- **p95 < 200ms** for read endpoints under 100-request batch
- **Audit trail complete**: every POST/PATCH has corresponding outbox event

## Reporting

After all tests complete, produce a summary:
```
SERVICE | EXISTING_PASS | NEW_PASS | NEW_FAIL | ISOLATION_OK | PERF_OK
```

If any NEW test fails, fix the underlying code (not the test) and re-run.
