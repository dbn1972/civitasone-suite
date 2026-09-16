/**
 * COMP-007 -- inventory-service `matching` module (three-way match:
 * PO x GRN x Invoice verification gating payment release) smoke test.
 *
 * Registered as both a route (POST/GET /v1/inventory/matches, GET .../:id,
 * POST .../:id/resolve) and a consumer (registerMatchingConsumers) but had
 * zero test references anywhere in the service. Financial-control-adjacent:
 * this is the payment-authorization gate described in domain.ts (Requirements
 * 14.10/14.11) -- a three-way match "exception" blocks payment, and even a
 * clean match additionally requires a signed Store Receipt Note per GFR Rule
 * 149 (see consumer.ts's own comment) before a payment.released event fires.
 *
 * CQRS like this campaign's other matching-shaped modules: the route
 * publishes a command, the real consumer (registered on the app's own shared
 * queue singleton, drained via q.drain()) does the actual DB write, reads go
 * through the module's own cache-through queries.getMatch()/listMatches()
 * backed by the real disposable Postgres.
 *
 * IMPORTANT (cost real diagnostic time, worth recording): every read route
 * here 404/empty-lists unless the request ALSO carries an `x-tenant-id`
 * header matching the JWT's `tid`. Root cause, confirmed directly: this
 * service's `createTenantTxHook` (packages/db/src/tenant-tx.ts) sets the
 * AsyncLocalStorage tenant context RLS relies on from
 * `req.headers["x-tenant-id"]` -- NOT from the verified JWT `resolveContext`
 * already decodes for authorization. In production this is populated by
 * gateway-service (server-verified, injected downstream after JWT
 * verification -- see its app.ts); nothing re-derives it from the JWT inside
 * inventory-service itself the way policy-service's app.ts does with its
 * second onRequest hook. This service's own tests/rls-isolation.test.ts
 * already establishes the convention of sending both headers together in
 * every request; followed here, not treated as a bug to report (a
 * gateway-fronted deployment has this header on every real request; a raw
 * app.inject() bypassing the gateway, like this test, does not, unless it
 * adds the header itself).
 *
 * REAL BUG (found while writing this test, not fixed here -- see PR
 * description): POST /v1/inventory/matches/:id/resolve never actually
 * resolves anything, for ANY match, regardless of the `version` sent.
 * Root cause, confirmed directly (see the KNOWN ISSUE test below): commands.ts's
 * shared `publish()` helper is called by BOTH createMatch() and
 * resolveMatch() with the MATCH's own id as the queue message's `messageId`
 * (`publish(type, ctx, id, payload)` -- the third positional arg is reused
 * for both the domain id and the transport-level idempotency key). create's
 * consumer handler already inserts `_inbox.processed` with
 * message_id = <matchId> to dedupe ITSELF; when resolve's message for that
 * SAME matchId arrives, `markProcessed(tx, msg.messageId)` (the very first
 * line of the resolve handler, before the version-gated UPDATE is ever
 * reached) finds that message_id already present and returns false, so the
 * handler bails immediately -- indistinguishable, from the outside, from a
 * genuine duplicate redelivery. The route still replies 202 "accepted"
 * (createMatch/resolveMatch never touch the DB; only the consumer does), so
 * nothing in the HTTP response reveals the failure. A direct consequence:
 * this also makes the optimistic-locking version check in resolve's own
 * WHERE clause dead code today -- it can never be reached to reject a stale
 * version, because every resolve attempt (correct version or not) is
 * already rejected one line earlier by the reused-messageId collision.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient, db } from "../src/shared/db.js";
import { processed } from "../src/shared/outbox.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { registerMatchingConsumers } from "../src/modules/matching/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function authHeaders(roles: string[], tid: string): Record<string, string> {
  const jwt = signToken({ sub: randomUUID(), tid, roles, sid: "sess-comp007-matching" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}

// The app's own registered matchingRoutes publish through the real shared
// `appQueue` singleton (see src/shared/infra.ts) -- the SAME instance
// createMatch()/resolveMatch() in commands.ts import. Registering the real
// consumer on that SAME instance (rather than a disconnected fresh queue) is
// what makes a route-level `app.inject()` create actually observable via the
// module's own GET routes below, matching this file's black-box HTTP style.
// No manual withTenantConsumer wiring needed here (unlike a bare `new
// MemoryQueue()`): createQueue() in shared/infra.ts already wraps .subscribe
// with it for every consumer registered on this instance.
registerMatchingConsumers(appQueue);
await appQueue.start();

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    poId: randomUUID(),
    grnId: randomUUID(),
    invoiceId: randomUUID(),
    poQty: 100,
    poRatePaise: "10000",
    grnQty: 100,
    invoiceQty: 100,
    invoiceRatePaise: "10000",
    tolerancePct: 5,
    ...overrides,
  };
}

describe("COMP-007: matching -- POST /v1/inventory/matches", () => {
  it("returns 401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/inventory/matches", payload: basePayload() });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role outside the write ACL", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/inventory/matches",
      headers: authHeaders(["citizen"], tid),
      payload: basePayload(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a non-numeric-string rate (400, real zod validation)", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/inventory/matches",
      headers: authHeaders(["inventory_admin"], tid),
      payload: basePayload({ poRatePaise: "not-a-number" }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("a clean match (zero variance) is real-DB-verified as 'matched' and not payment-blocked", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST",
      url: "/v1/inventory/matches",
      headers: authHeaders(["inventory_admin"], tid),
      payload: basePayload(),
    });
    expect(create.statusCode).toBe(202);
    const { id } = create.json();
    await appQueue.drain();

    const get = await app.inject({
      method: "GET",
      url: `/v1/inventory/matches/${id}`,
      headers: authHeaders(["inventory_admin"], tid),
    });
    expect(get.statusCode).toBe(200);
    const row = get.json().data;
    expect(row.status).toBe("matched");
    expect(row.paymentBlocked).toBe(0);
    expect(row.version).toBe(1);
  });

  it("a match with invoice qty grossly exceeding PO/GRN qty is real-DB-verified as 'exception' and payment-blocked", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST",
      url: "/v1/inventory/matches",
      headers: authHeaders(["inventory_admin"], tid),
      payload: basePayload({ invoiceQty: 200 }), // 100% over a 5% tolerance
    });
    const { id } = create.json();
    await appQueue.drain();

    const get = await app.inject({
      method: "GET",
      url: `/v1/inventory/matches/${id}`,
      headers: authHeaders(["inventory_admin"], tid),
    });
    const row = get.json().data;
    expect(row.status).toBe("exception");
    expect(row.paymentBlocked).toBe(1);
    expect(row.qtyVariances.length).toBeGreaterThan(0);
  });

  it("a match created under tenant A returns 404 when read back under tenant B", async () => {
    const tidA = randomUUID();
    const tidB = randomUUID();
    const create = await app.inject({
      method: "POST",
      url: "/v1/inventory/matches",
      headers: authHeaders(["inventory_admin"], tidA),
      payload: basePayload(),
    });
    const { id } = create.json();
    await appQueue.drain();

    const crossTenant = await app.inject({
      method: "GET",
      url: `/v1/inventory/matches/${id}`,
      headers: authHeaders(["inventory_admin"], tidB),
    });
    expect(crossTenant.statusCode).toBe(404);
  });
});

describe("COMP-007: matching -- POST /v1/inventory/matches/:id/resolve", () => {
  it("returns 403 for a role outside the (narrower) resolve ACL, even though it can create", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST",
      url: "/v1/inventory/matches",
      headers: authHeaders(["inventory_manager"], tid), // can create (WRITE_ROLES)...
      payload: basePayload({ invoiceQty: 200 }),
    });
    const { id } = create.json();
    await appQueue.drain();

    const resolve = await app.inject({
      method: "POST",
      url: `/v1/inventory/matches/${id}/resolve`,
      headers: authHeaders(["inventory_manager"], tid), // ...but NOT resolve (RESOLVE_ROLES)
      payload: { version: 1, resolutionNote: "reviewed" },
    });
    expect(resolve.statusCode).toBe(403);
  });

  it("KNOWN ISSUE (see file header): resolve with the CORRECT version still never applies -- the route 202s but the real DB row never changes", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST",
      url: "/v1/inventory/matches",
      headers: authHeaders(["inventory_admin"], tid),
      payload: basePayload({ invoiceQty: 200 }),
    });
    const { id } = create.json();
    await appQueue.drain();

    const resolve = await app.inject({
      method: "POST",
      url: `/v1/inventory/matches/${id}/resolve`,
      headers: authHeaders(["inventory_admin"], tid),
      payload: { version: 1, resolutionNote: "Verified with vendor; short-shipment credit note issued." },
    });
    // NOT proof of success -- createMatch/resolveMatch never touch the DB,
    // only publish a command; this 202 is the same "accepted" createMatch
    // itself already returned and reveals nothing about whether the
    // consumer's update actually applied.
    expect(resolve.statusCode).toBe(202);
    await appQueue.drain();

    const get = await app.inject({
      method: "GET",
      url: `/v1/inventory/matches/${id}`,
      headers: authHeaders(["inventory_admin"], tid),
    });
    const row = get.json().data;
    // This is the bug, asserted directly: a version-1 resolve of a version-1
    // row is NOT rejected by the optimistic lock (a real conflict would look
    // exactly like this too) -- it silently never runs at all.
    expect(row.status).toBe("exception"); // NOT "resolved" -- documents the bug
    expect(row.version).toBe(1); // NOT bumped to 2

    // Prove WHY, rather than merely asserting an absence: resolveMatch's
    // publish() call reused the match's own `id` as the queue message's
    // messageId (see commands.ts), the exact same messageId createMatch's
    // message already used for THIS match. `_inbox.processed` -- this
    // service's real, disposable-Postgres-backed idempotency ledger, not a
    // mock -- shows exactly one row for it, meaning the resolve command was
    // consumed by markProcessed() as if it were a *duplicate delivery of
    // create*, and its handler returned before ever reaching the
    // version-gated UPDATE.
    const inboxRows = await db.select().from(processed).where(eq(processed.messageId, id));
    expect(inboxRows).toHaveLength(1);
  });

  it("KNOWN ISSUE (see file header): because of the same messageId-reuse bug, a WRONG version is also never rejected -- the version check is unreachable dead code today", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST",
      url: "/v1/inventory/matches",
      headers: authHeaders(["inventory_admin"], tid),
      payload: basePayload({ invoiceQty: 200 }),
    });
    const { id } = create.json();
    await appQueue.drain();

    const staleResolve = await app.inject({
      method: "POST",
      url: `/v1/inventory/matches/${id}/resolve`,
      headers: authHeaders(["inventory_admin"], tid),
      payload: { version: 999, resolutionNote: "wrong version" },
    });
    expect(staleResolve.statusCode).toBe(202);
    await appQueue.drain();

    const get = await app.inject({
      method: "GET",
      url: `/v1/inventory/matches/${id}`,
      headers: authHeaders(["inventory_admin"], tid),
    });
    const row = get.json().data;
    // Today, this looks identical to a correctly-enforced optimistic lock
    // (unchanged row) -- but see the test above: a CORRECT version is
    // rejected exactly the same way, for an unrelated reason. This test
    // alone cannot and does not prove the version check works; it only
    // shows that a wrong version does not crash anything.
    expect(row.status).toBe("exception");
    expect(row.version).toBe(1);
  });
});

describe("COMP-007: matching -- GET /v1/inventory/matches (list + filter)", () => {
  it("lists only this tenant's matches and filters by status", async () => {
    const tid = randomUUID();
    const clean = await app.inject({
      method: "POST",
      url: "/v1/inventory/matches",
      headers: authHeaders(["inventory_admin"], tid),
      payload: basePayload(),
    });
    const exception = await app.inject({
      method: "POST",
      url: "/v1/inventory/matches",
      headers: authHeaders(["inventory_admin"], tid),
      payload: basePayload({ invoiceQty: 300 }),
    });
    await appQueue.drain();

    const listAll = await app.inject({
      method: "GET",
      url: "/v1/inventory/matches",
      headers: authHeaders(["audit_officer"], tid),
    });
    expect(listAll.statusCode).toBe(200);
    const ids = listAll.json().data.map((r: any) => r.id);
    expect(ids).toContain(clean.json().id);
    expect(ids).toContain(exception.json().id);

    const listException = await app.inject({
      method: "GET",
      url: "/v1/inventory/matches?status=exception",
      headers: authHeaders(["audit_officer"], tid),
    });
    const exceptionIds = listException.json().data.map((r: any) => r.id);
    expect(exceptionIds).toContain(exception.json().id);
    expect(exceptionIds).not.toContain(clean.json().id);
  });
});
