/**
 * COMP-007 -- policy-service `bindings` module (role bindings + breakglass)
 * smoke test.
 *
 * Registered as both a route (POST/DELETE /policy/bindings, POST
 * /policy/breakglass) and a consumer (registerBindingConsumers) but had zero
 * test references anywhere in the service. There is no GET route for
 * bindings/breakglass (write-only HTTP surface, CQRS via the command queue +
 * consumer), so materialization is verified the same way this service's own
 * abac-routes.test.ts verifies its own async-consumer writes: a real
 * in-memory queue (QUEUE_DRIVER=memory per vitest.config.ts),
 * registerBindingConsumers() wired before buildApp(), then poll the real
 * table directly via readScoped() (the same tenant-scoped helper routes.ts
 * itself uses for reads) until the consumer has processed the message.
 *
 * NOTE (found while writing this test, not fixed here -- see PR description):
 * this module's routes are registered at the bare paths `/policy/bindings`
 * and `/policy/breakglass` (no `/v1` prefix), unlike every sibling module in
 * this service (e.g. policies: `/v1/policy/policies`). The gateway's
 * "policy-v1" registry entry (services/gateway-service/src/registry.ts,
 * prefix `/api/v1/policy`, no upstreamPath override) forwards to upstream
 * path `/v1/policy/<remainder>` -- and apps/web's BindingCreateForm.tsx /
 * policy/_data.ts call exactly that, `/api/v1/policy/bindings`. That
 * resolves upstream to `/v1/policy/bindings`, which this router never
 * registers, so the real Bindings UI page 404s end-to-end in production.
 * This test exercises the route as it is actually coded (`/policy/bindings`),
 * which is reachable only via the gateway's non-versioned "policy" entry
 * (`/api/policy/...`) that nothing in apps/web actually calls.
 *
 * SECOND BUG (found while writing this test, not fixed here -- see PR
 * description): both POST /policy/bindings and POST /policy/breakglass
 * return a raw, unformatted Fastify default 500
 * (`{"statusCode":500,"error":"Internal Server Error","message":"[...zod
 * issues JSON...]"}`) on invalid input, instead of this service's uniform
 * `{code:"VALIDATION_FAILED", ...}` 400 envelope. Verified this is NOT a
 * test-isolation artifact: reproduced against a fresh buildApp() with no
 * other requests made first. Verified it is NOT a service-wide gap either --
 * sibling modules in this same app (abac's POST /v1/policy/abac/rules, roles'
 * POST /policy/roles) use the identical bare `body.parse(req.body)` pattern
 * and correctly get mapped to 400 by the app-level registerSchemaErrorHandler
 * in src/app.ts, so that handler demonstrably works and IS reachable from
 * routes registered the same way bindings' are. The two mutating handlers in
 * this file are the only ones affected. One concrete lead for whoever picks
 * this up: this file imports `ZodError` from "zod" at the top but never
 * references it anywhere below -- consistent with a local try/catch ->
 * HttpError(400, ...) conversion (the same shape policies/routes.ts's own
 * `safeParse()` helper uses) having existed here once and been removed,
 * leaving the dead import behind. The two tests below assert today's actual
 * (broken) behavior rather than the correct one, so they fail loudly the
 * moment this is fixed rather than silently asserting something false.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { readScoped, sqlClient } from "../src/shared/db.js";
import { registerBindingConsumers } from "../src/modules/bindings/consumer.js";
import { roleBindings, breakglass } from "../src/modules/bindings/schema.js";

registerBindingConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const USER_ID = randomUUID();
const ROLE_ID = randomUUID();
// `sub` MUST be a real UUID here (not a human-readable string like other
// smoke tests in this campaign use) -- unlike those tests' routes, bindings'
// consumer persists ctx.actorId verbatim into a `uuid` NOT NULL column
// (createdBy/updatedBy). A non-UUID sub is accepted fine through auth and the
// 202 route response, then fails silently: MemoryQueue.deliver() (see
// services/queue-service/src/bus.ts) catches the resulting real Postgres
// error ("invalid input syntax for type uuid"), retries it 5x, and dead-letters
// it to an in-memory `queue.dlq` array with NO console output at all -- unlike
// SqsQueue's poll loop, which logs every failure via captureError/console.error.
// Confirmed by direct inspection of `queue.dlq` while diagnosing this. Not a
// production bug (real callers' JWTs always carry a real user UUID as `sub`),
// but a real, silent debugging trap in this test/dev-only queue adapter --
// worth knowing if a future test here hangs the same way.
const ACTOR_SUB = "00000000-aaaa-4000-8000-000000000710";

function token(roles: string[], tid = TENANT_A) {
  return signToken({ sub: ACTOR_SUB, tid, roles, sid: "sess-comp007-bindings" }, SECRET);
}

const app = await buildApp();

async function findBinding(id: string, tenantId: string) {
  const rows = await readScoped(tenantId, (tx: any) => tx.select().from(roleBindings).where(eq(roleBindings.id, id)));
  return rows[0] ?? null;
}
async function findBreakglass(id: string, tenantId: string) {
  const rows = await readScoped(tenantId, (tx: any) => tx.select().from(breakglass).where(eq(breakglass.id, id)));
  return rows[0] ?? null;
}
async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 10000): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const r = await fn();
    if (r) return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error("condition never materialized in time");
}

afterEach(async () => {
  // Let every in-flight delivery (incl. retries and the audit-emit that
  // rides along inside the same consumer transaction) fully settle before the
  // next test starts. Without this, a still-retrying/still-auditing prior
  // test's DB work contends with the next test's fresh publish for the same
  // small pg connection pool -- observed directly: the "cross-tenant" test
  // below is solid in isolation (~650ms) but intermittently blew past a 3s
  // waitFor when run after the create+revoke test in the same file/queue.
  await (queue as unknown as { drain(): Promise<void> }).drain();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("COMP-007: bindings -- POST /policy/bindings", () => {
  it("returns 401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/policy/bindings",
      payload: { userId: USER_ID, roleId: ROLE_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/policy/bindings",
      headers: { authorization: `Bearer ${token(["staff"])}` },
      payload: { userId: USER_ID, roleId: ROLE_ID },
    });
    expect(res.statusCode).toBe(403);
  });

  it("BUG regression guard (see file header): an invalid body currently 500s, not 400s", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/policy/bindings",
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
      payload: { userId: "not-a-uuid" },
    });
    // NOT the correct/desired behavior -- documents today's actual bug so this
    // test fails (loudly, in the right direction) the moment it's fixed.
    expect(res.statusCode).toBe(500);
    expect(res.json().code).not.toBe("VALIDATION_FAILED");
  });

  it("accepts as tenant_admin, and the consumer really writes an active binding row, then revoke transitions it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/policy/bindings",
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
      payload: { userId: USER_ID, roleId: ROLE_ID },
    });
    expect(res.statusCode).toBe(202);
    const { id } = res.json();

    const row = await waitFor(() => findBinding(id, TENANT_A));
    expect(row.status).toBe("active");
    expect(row.userId).toBe(USER_ID);
    expect(row.roleId).toBe(ROLE_ID);
    expect(row.tenantId).toBe(TENANT_A);
    expect(row.version).toBe(1);

    const del = await app.inject({
      method: "DELETE",
      url: `/policy/bindings/${id}`,
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
    });
    expect(del.statusCode).toBe(202);

    const revoked = await waitFor(async () => {
      const r = await findBinding(id, TENANT_A);
      return r && r.status === "revoked" ? r : null;
    });
    expect(revoked.version).toBe(2);
  }, 25000);

  it("a binding created under tenant A is invisible when read back under tenant B's RLS scope", async () => {
    // Deliberately its OWN fresh (userId, roleId) pair, distinct from every
    // other test in this file -- see the unique-index bug documented and
    // proven below. Reusing USER_ID/ROLE_ID here would silently collide with
    // the already-revoked binding the earlier test leaves behind for that
    // exact (tenant, user, role) triple, which is a different bug than the
    // tenant-isolation behavior this test exists to prove.
    const res = await app.inject({
      method: "POST",
      url: "/policy/bindings",
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
      payload: { userId: randomUUID(), roleId: randomUUID() },
    });
    const { id } = res.json();
    await waitFor(() => findBinding(id, TENANT_A));
    const crossTenantRow = await findBinding(id, TENANT_B);
    expect(crossTenantRow).toBeNull();
  }, 15000);

  it("BUG (found while writing this test, not fixed here -- see PR description): a revoked binding can never be re-granted for the same (tenant, user, role)", async () => {
    // migrations/0001_init.sql: `CREATE UNIQUE INDEX ... ON bindings.bindings
    // (tenant_id, user_id, role_id)` -- a PLAIN unique index, not partial
    // (no `WHERE status = 'active'`). So once ANY binding, active or
    // revoked, has existed for a given triple, Postgres permanently refuses
    // a second row for that same triple. An admin who revokes a role and
    // later wants to re-grant it to the same user is silently unable to,
    // forever -- the create route still replies 202 "accepted" (the route
    // itself never touches the DB; only the async consumer does), so nothing
    // in the HTTP response reveals the failure.
    const userId = randomUUID();
    const roleId = randomUUID();

    const first = await app.inject({
      method: "POST",
      url: "/policy/bindings",
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
      payload: { userId, roleId },
    });
    const firstId = first.json().id;
    await waitFor(() => findBinding(firstId, TENANT_A));

    const revoke = await app.inject({
      method: "DELETE",
      url: `/policy/bindings/${firstId}`,
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
    });
    expect(revoke.statusCode).toBe(202);
    await waitFor(async () => {
      const r = await findBinding(firstId, TENANT_A);
      return r && r.status === "revoked" ? r : null;
    });

    // Re-grant attempt: same tenant, same userId, same roleId, a brand-new
    // binding id. The route still says 202...
    const second = await app.inject({
      method: "POST",
      url: "/policy/bindings",
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
      payload: { userId, roleId },
    });
    expect(second.statusCode).toBe(202);
    const secondId = second.json().id;

    // ...but it never materializes. Let the consumer exhaust its 5 retries
    // and dead-letter, then prove exactly why via the DLQ entry itself,
    // rather than merely asserting an absence.
    await (queue as unknown as { drain(): Promise<void> }).drain();
    const neverAppeared = await findBinding(secondId, TENANT_A);
    expect(neverAppeared).toBeNull();

    const dlq = (queue as unknown as { dlq: Array<{ topic: string; msg: { messageId: string }; error: string }> }).dlq;
    const dlqEntry = dlq.find((d) => d.msg.messageId === secondId);
    expect(dlqEntry, "expected the re-grant attempt to be dead-lettered").toBeTruthy();
    expect(dlqEntry!.error).toContain("idx_bindings_user_role");
  }, 20000);
});

describe("COMP-007: bindings -- POST /policy/breakglass", () => {
  it("returns 403 for a non-admin role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/policy/breakglass",
      headers: { authorization: `Bearer ${token(["staff"])}` },
      payload: { scope: "finance:*", reason: "need emergency access to close month-end" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("accepts as tenant_admin, and the consumer really writes a pending breakglass row", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/policy/breakglass",
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
      payload: { scope: "finance:*", reason: "need emergency access to close month-end", durationMinutes: 30 },
    });
    expect(res.statusCode).toBe(202);
    const { id } = res.json();
    const row = await waitFor(() => findBreakglass(id, TENANT_A));
    expect(row.status).toBe("pending");
    expect(row.scope).toBe("finance:*");
    expect(row.requesterId).toBeTruthy();
  }, 15000);

  it("BUG regression guard (see file header): an invalid body currently 500s, not 400s", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/policy/breakglass",
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
      payload: { scope: "finance:*", reason: "too short" },
    });
    // NOT the correct/desired behavior -- documents today's actual bug so this
    // test fails (loudly, in the right direction) the moment it's fixed.
    expect(res.statusCode).toBe(500);
    expect(res.json().code).not.toBe("VALIDATION_FAILED");
  });
});
