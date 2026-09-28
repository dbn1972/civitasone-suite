/**
 * COMP-007 -- inventory-service `cycle-count` module (physical-vs-system
 * stock count, auto-post within threshold, approval workflow above it)
 * smoke test.
 *
 * Registered as both a route (POST/GET /v1/inventory/cycle-counts,
 * GET .../:id, POST .../:id/{approve,reject}) and a consumer
 * (registerCycleCountConsumers, registered on the app's own shared queue
 * singleton, drained via q.drain()) but had zero test references anywhere in
 * the service. Same CQRS style as this service's `matching` module (COMP-007
 * tranche 2) -- registering the real consumer on the SAME instance
 * createCycleCount()/approveCycleCount()/rejectCycleCount() in commands.ts
 * import is what makes a route-level app.inject() create observable via the
 * module's own GET routes.
 *
 * Every read route here 404s/empty-lists unless the request ALSO carries an
 * `x-tenant-id` header matching the JWT's `tid`, same established convention
 * this service's own tests/rls-isolation.test.ts and comp-007-matching-smoke
 * already follow -- followed here too.
 *
 * REAL BUG #1 (found while writing this test) -- NOW FIXED, see
 * migrations/0021_cycle_counts_status_chk_fix.sql and
 * tests/cycle-count-lifecycle.integration.test.ts. Originally confirmed via a
 * LIVE POSTGRES ERROR, not just static reading: every single cycle-count
 * create failed, for every tenant, regardless of variance -- the module's
 * write path was completely non-functional. Root cause:
 * migrations/0011_cost_layers_cycle_counts.sql's `cycle_counts_status_chk`
 * CHECK constraint allowed only ('pending', 'approved', 'rejected',
 * 'auto_adjusted') -- but domain.ts's `evaluateCycleCount()` (the ONLY
 * function that computes a status for a new row) can only ever return
 * 'auto_posted' or 'pending_approval', NEITHER of which the original
 * constraint allowed. The route still replied 202 "accepted" (createCycleCount
 * never touches the DB, only publishes a command), so nothing in the HTTP
 * response revealed the failure -- confirmed at the time via the queue's own
 * DLQ, which captured the real Postgres error (`new row for relation
 * "cycle_counts" violates check constraint "cycle_counts_status_chk"`) after
 * all retries were exhausted. Migration 0021 widens the constraint to the
 * vocabulary domain.ts/validators.ts (and this file's own basePayload/
 * assertions) already agreed on.
 *
 * REAL BUG #2 (found by CODE TRACING at the time) -- NOW FIXED, see
 * commands.ts's `publish()` doc comment. Same messageId-reuse shape this
 * service's `matching` module was already disclosed for in COMP-007 tranche
 * 2 (still open there -- out of scope for this fix). commands.ts's shared
 * `publish(type, ctx, id, payload)` helper was called by createCycleCount()
 * with a FRESH randomUUID as both the new record's domain id and the
 * message's transport-level idempotency key (messageId) -- but
 * approveCycleCount(ctx, id, version) and rejectCycleCount(ctx, id, version,
 * reason) were called with the ROUTE'S `:id` PARAMETER (the EXISTING cycle
 * count's own id) as that same third positional argument, so their messages'
 * messageId was the identical value create's message already used. create's
 * consumer handler already inserts `_inbox.processed` with message_id =
 * <cycleCountId> to dedupe ITSELF; when approve's (or reject's) message for
 * that SAME id arrived, `markProcessed(tx, msg.messageId)` -- the very first
 * line of both handlers, before the version-gated UPDATE was ever reached --
 * found that message_id already present and returned false, bailing
 * immediately. Not independently demonstrable in THIS file at the time (bug
 * #1 blocked any row from ever reaching 'pending_approval' through any path
 * first) -- reproduced live instead in
 * tests/cycle-count-lifecycle.integration.test.ts, which drives approve/
 * reject after bug #1 is fixed and confirms both now actually apply.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { registerCycleCountConsumers } from "../src/modules/cycle-count/consumer.js";
import { registerItemConsumers } from "../src/modules/items/consumer.js";
import { registerStoreConsumers } from "../src/modules/stores/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function authHeaders(roles: string[], tid: string): Record<string, string> {
  const jwt = signToken({ sub: randomUUID(), tid, roles, sid: "sess-comp007-cycle-count" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}

registerCycleCountConsumers(appQueue);
// Needed only for the auto-post case below: postReconciliation() now writes a
// real inventory.movements row (fk_inv_mov_to_store -> inventory.stores), so
// an auto-posted cycle count needs a genuine store to exist, not just any
// random UUID in warehouseId (see cycle-count/consumer.ts's postReconciliation
// doc comment for why warehouseId is, despite its name, a stores.id).
registerItemConsumers(appQueue);
registerStoreConsumers(appQueue);
await appQueue.start();

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    itemId: randomUUID(),
    warehouseId: randomUUID(),
    physicalQty: 5,
    reasonCode: "PHYSICAL_RECOUNT",
    ...overrides,
  };
}

/**
 * Creates a real inventory.stores row and returns its id, via the app's own
 * write path. Always uses "inventory_manager" (stores' own WRITE_ROLES don't
 * include "store_keeper") regardless of which role the calling test uses for
 * its own cycle-count actions, on the SAME tenant.
 */
async function seedStore(tid: string): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/inventory/stores", headers: authHeaders(["inventory_manager"], tid),
    payload: { name: "COMP-007 Store", code: `C7-${randomUUID().slice(0, 8)}` },
  });
  if (res.statusCode !== 202) throw new Error(`seedStore failed: ${res.statusCode} ${res.body}`);
  const { id } = res.json();
  await appQueue.drain();
  return id;
}

/** Creates a real inventory.items row and returns its id, via the app's own write path. */
async function seedItem(tid: string): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/inventory/items", headers: authHeaders(["inventory_manager"], tid),
    payload: { name: "COMP-007 Item" },
  });
  if (res.statusCode !== 202) throw new Error(`seedItem failed: ${res.statusCode} ${res.body}`);
  const { id } = res.json();
  await appQueue.drain();
  return id;
}

describe("COMP-007: cycle-count -- auth/validation gates that fail BEFORE reaching the (broken) queue/DB", () => {
  it("returns 401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/inventory/cycle-counts", payload: basePayload() });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role outside the write ACL", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/cycle-counts",
      headers: authHeaders(["citizen"], tid),
      payload: basePayload(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a negative physicalQty (400, real zod validation)", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/cycle-counts",
      headers: authHeaders(["store_keeper"], tid),
      payload: basePayload({ physicalQty: -1 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for a role outside the (narrower) approve ACL, even though it can create", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST", url: `/v1/inventory/cycle-counts/${randomUUID()}/approve`,
      headers: authHeaders(["store_keeper"], tid), // can create (WRITE_ROLES)...
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(403); // ...but NOT approve (APPROVE_ROLES) -- role check runs before any DB lookup
  });
});

describe("COMP-007: cycle-count -- bug #1 FIXED: create actually lands now (see file header)", () => {
  it("a small variance (auto_posted): 202, and GET /:id now returns the real persisted row, no DLQ entry", async () => {
    const tid = randomUUID();
    const h = authHeaders(["store_keeper"], tid);
    const storeId = await seedStore(tid);
    const itemId = await seedItem(tid);
    const create = await app.inject({
      method: "POST", url: "/v1/inventory/cycle-counts", headers: h,
      payload: basePayload({ itemId, warehouseId: storeId, physicalQty: 5 }), // no prior balance -> systemQty 0, variance 5, within the 10-unit floor -> 'auto_posted'
    });
    expect(create.statusCode).toBe(202);
    const { id } = create.json();
    await appQueue.drain();

    const get = await app.inject({ method: "GET", url: `/v1/inventory/cycle-counts/${id}`, headers: h });
    expect(get.statusCode).toBe(200); // the row is genuinely persisted now
    expect(get.json().data.status).toBe("auto_posted");

    const dlqEntry = (appQueue as unknown as { dlq: Array<{ msg: { messageId: string }; error: string }> }).dlq
      .find((e) => e.msg.messageId === id);
    expect(dlqEntry).toBeUndefined();
  });

  it("a large variance (pending_approval): 202, GET /:id returns the persisted row awaiting approval, no DLQ entry", async () => {
    const tid = randomUUID();
    const h = authHeaders(["store_keeper"], tid);
    const create = await app.inject({
      method: "POST", url: "/v1/inventory/cycle-counts", headers: h,
      payload: basePayload({ physicalQty: 80 }), // variance 80, above the 10-unit floor -> 'pending_approval' (no reconciliation write on this path, so no real store needed here)
    });
    expect(create.statusCode).toBe(202);
    const { id } = create.json();
    await appQueue.drain();

    const get = await app.inject({ method: "GET", url: `/v1/inventory/cycle-counts/${id}`, headers: h });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.status).toBe("pending_approval");

    const dlqEntry = (appQueue as unknown as { dlq: Array<{ msg: { messageId: string }; error: string }> }).dlq
      .find((e) => e.msg.messageId === id);
    expect(dlqEntry).toBeUndefined();
  });
});

describe("COMP-007: cycle-count -- list/read paths", () => {
  it("GET /v1/inventory/cycle-counts is a real DB round trip: 200 with an empty list for a fresh tenant", async () => {
    const tid = randomUUID();
    const res = await app.inject({ method: "GET", url: "/v1/inventory/cycle-counts", headers: authHeaders(["audit_officer"], tid) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
    expect(res.json().meta.total).toBe(0);
  });

  it("GET /:id 404s for a genuinely nonexistent id", async () => {
    const tid = randomUUID();
    const res = await app.inject({ method: "GET", url: `/v1/inventory/cycle-counts/${randomUUID()}`, headers: authHeaders(["store_keeper"], tid) });
    expect(res.statusCode).toBe(404);
  });
});
