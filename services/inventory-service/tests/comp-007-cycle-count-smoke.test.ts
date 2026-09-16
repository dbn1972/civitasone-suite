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
 * REAL BUG #1 (found while writing this test, not fixed here -- see PR
 * description), CONFIRMED VIA A LIVE POSTGRES ERROR, NOT JUST STATIC READING:
 * every single cycle-count create fails, for every tenant, regardless of
 * variance -- the module's write path is completely non-functional. Root
 * cause: migrations/0011_cost_layers_cycle_counts.sql's
 * `cycle_counts_status_chk` CHECK constraint allows only
 * ('pending', 'approved', 'rejected', 'auto_adjusted') -- but domain.ts's
 * `evaluateCycleCount()` (the ONLY function that computes a status for a new
 * row) can only ever return 'auto_posted' or 'pending_approval', NEITHER of
 * which the constraint allows (grepped every migration in this service --
 * 0011 is the only one that ever touches this table or constraint; nothing
 * later fixes it). The route still replies 202 "accepted" (createCycleCount
 * never touches the DB, only publishes a command), so nothing in the HTTP
 * response reveals the failure -- confirmed below via the queue's own DLQ,
 * which captures the real Postgres error
 * (`new row for relation "cycle_counts" violates check constraint
 * "cycle_counts_status_chk"`) after all retries are exhausted.
 *
 * REAL BUG #2 (found by CODE TRACING, not independently live-reproducible --
 * see below for why): even if bug #1 were fixed, approve and reject would
 * still never actually apply, for the IDENTICAL messageId-reuse reason this
 * same service's `matching` module was already disclosed for in COMP-007
 * tranche 2. commands.ts's shared `publish(type, ctx, id, payload)` helper is
 * called by createCycleCount() with a FRESH randomUUID as both the new
 * record's domain id and the message's transport-level idempotency key
 * (messageId) -- but approveCycleCount(ctx, id, version) and
 * rejectCycleCount(ctx, id, version, reason) are called with the ROUTE'S
 * `:id` PARAMETER (the EXISTING cycle count's own id) as that same third
 * positional argument, so their messages' messageId is the identical value
 * create's message already used. create's consumer handler already inserts
 * `_inbox.processed` with message_id = <cycleCountId> to dedupe ITSELF (or
 * would, if bug #1 didn't make it fail before reaching that line); when
 * approve's (or reject's) message for that SAME id arrives,
 * `markProcessed(tx, msg.messageId)` -- the very first line of both
 * handlers, before the version-gated UPDATE is ever reached -- would find
 * that message_id already present and return false, bailing immediately.
 * NOT independently demonstrated end to end here: bug #1 means no row can
 * ever reach `pending_approval` (the only status approve/reject's own WHERE
 * clause accepts) through ANY path -- not even a raw INSERT bypassing the
 * application, since the SAME Postgres-level CHECK constraint blocks that
 * status value regardless of who issues the write. Both bugs are real,
 * independent, and would need fixing together for this module to work at
 * all -- exactly the same "two independent bugs compound" shape this
 * tranche's road-hotspot test found in a different service.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { registerCycleCountConsumers } from "../src/modules/cycle-count/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function authHeaders(roles: string[], tid: string): Record<string, string> {
  const jwt = signToken({ sub: randomUUID(), tid, roles, sid: "sess-comp007-cycle-count" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}

registerCycleCountConsumers(appQueue);
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

describe("COMP-007: cycle-count -- KNOWN ISSUE #1 (see file header): every create silently fails, real Postgres error confirmed via the DLQ", () => {
  it("a small variance (would-be auto_posted): 202 response, but the row never lands -- GET /:id 404s right after", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST", url: "/v1/inventory/cycle-counts",
      headers: authHeaders(["store_keeper"], tid),
      payload: basePayload({ physicalQty: 5 }), // variance 5, within the 10-unit floor -> would be 'auto_posted'
    });
    expect(create.statusCode).toBe(202); // misleading -- see file header
    const { id } = create.json();
    await appQueue.drain();

    const get = await app.inject({ method: "GET", url: `/v1/inventory/cycle-counts/${id}`, headers: authHeaders(["store_keeper"], tid) });
    expect(get.statusCode).toBe(404); // the "created" row was never actually written

    const dlqEntry = (appQueue as unknown as { dlq: Array<{ msg: { messageId: string }; error: string }> }).dlq
      .find((e) => e.msg.messageId === id);
    expect(dlqEntry?.error).toContain('violates check constraint "cycle_counts_status_chk"');
  });

  it("a large variance (would-be pending_approval): identical failure -- the constraint blocks BOTH statuses the domain layer can ever produce", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST", url: "/v1/inventory/cycle-counts",
      headers: authHeaders(["store_keeper"], tid),
      payload: basePayload({ physicalQty: 80 }), // variance 80, above the 10-unit floor -> would be 'pending_approval'
    });
    expect(create.statusCode).toBe(202);
    const { id } = create.json();
    await appQueue.drain();

    const get = await app.inject({ method: "GET", url: `/v1/inventory/cycle-counts/${id}`, headers: authHeaders(["store_keeper"], tid) });
    expect(get.statusCode).toBe(404);

    const dlqEntry = (appQueue as unknown as { dlq: Array<{ msg: { messageId: string }; error: string }> }).dlq
      .find((e) => e.msg.messageId === id);
    expect(dlqEntry?.error).toContain('violates check constraint "cycle_counts_status_chk"');
  });
});

describe("COMP-007: cycle-count -- list/read paths, given the module's actual (broken) state", () => {
  it("GET /v1/inventory/cycle-counts is a real DB round trip: 200 with an empty list, not a 500 -- consistent with bug #1 (no row can ever be created)", async () => {
    const tid = randomUUID();
    const res = await app.inject({ method: "GET", url: "/v1/inventory/cycle-counts", headers: authHeaders(["audit_officer"], tid) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
    expect(res.json().meta.total).toBe(0);
  });

  it("GET /:id 404s for a genuinely nonexistent id (independent of bug #1)", async () => {
    const tid = randomUUID();
    const res = await app.inject({ method: "GET", url: `/v1/inventory/cycle-counts/${randomUUID()}`, headers: authHeaders(["store_keeper"], tid) });
    expect(res.statusCode).toBe(404);
  });
});
