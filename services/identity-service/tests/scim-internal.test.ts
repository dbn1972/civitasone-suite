/**
 * SCIM routes via x-internal service-to-service path.
 *
 * The SCIM routes are behind the global authPlugin JWT check. In production,
 * they're accessed via the x-internal path (service-to-service). This test
 * uses that path with INTERNAL_SERVICE_SECRET to exercise the SCIM handler code.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { withTenantConsumer } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";

const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "test-internal-service-secret-32chr";

const internalHeaders = {
  "x-internal": "1",
  "x-tenant-id": TENANT,
  "x-service-secret": INTERNAL_SECRET,
};

let app: FastifyInstance;
let scimQueue: MemoryQueue;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();

  // scim/commands.ts's scimCreateUser/Replace/Patch/Delete are F3 async —
  // each only queue.publish()es and returns a 202 envelope; the actual write
  // happens in registerScimConsumers's handlers. Without registering that
  // consumer on the shared `queue` singleton (the same one scim/commands.ts
  // imports from shared/infra.js — app.js never starts it; only worker.ts
  // does, in a separate process), every enqueued command here is silently
  // never processed, so createdUserId's row never actually exists and the
  // GET/PUT/PATCH/DELETE tests below that depend on it were previously
  // silently no-op'd by their `if (!createdUserId) return;` guards.
  const { queue } = await import("../src/shared/infra.js");
  const { registerScimConsumers } = await import("../src/modules/scim/consumer.js");
  const rawSubscribe = queue.subscribe.bind(queue);
  queue.subscribe = ((topic: string, handler: any) =>
    rawSubscribe(topic, withTenantConsumer(handler))) as typeof queue.subscribe;
  registerScimConsumers(queue);
  await queue.start();
  scimQueue = queue as unknown as MemoryQueue;
});
afterAll(async () => { await app.close(); });

async function drainScimQueue(): Promise<void> {
  await scimQueue.drain();
}

describe("SCIM via x-internal — ServiceProviderConfig", () => {
  it("GET /v1/identity/scim/ServiceProviderConfig → 200 with SCIM schema", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/identity/scim/ServiceProviderConfig",
      headers: internalHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schemas).toContain("urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig");
    expect(body.patch.supported).toBe(true);
    expect(body.filter.supported).toBe(true);
    expect(body.filter.maxResults).toBe(200);
  });
});

describe("SCIM via x-internal — Users CRUD", () => {
  let createdUserId: string | null = null;

  it("GET /v1/identity/scim/Users → 200 with ListResponse (but SCIM auth rejects internal token)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/identity/scim/Users",
      headers: internalHeaders,
    });
    // x-internal passes authPlugin, but requireScimAuth checks authorization header
    // The x-internal path sets req.ctx but authorization header will be the x-service-secret
    // requireScimAuth reads req.headers.authorization — which is NOT set in x-internal mode
    // So this will return 401 from requireScimAuth
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/identity/scim/Users with SCIM bearer in authorization + x-internal → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/identity/scim/Users",
      headers: {
        ...internalHeaders,
        authorization: `Bearer ${process.env.SCIM_BEARER_TOKEN}`,
      },
    });
    // The authPlugin sees x-internal=1 and passes through (ignores authorization header)
    // Then requireScimAuth reads authorization header and validates the SCIM token
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schemas).toContain("urn:ietf:params:scim:api:messages:2.0:ListResponse");
    expect(body).toHaveProperty("totalResults");
    expect(body).toHaveProperty("Resources");
  });

  it("POST /v1/identity/scim/Users → 202 accepted", async () => {
    const email = `scim-internal-${Date.now()}@coverage.gov.in`;
    const res = await app.inject({
      method: "POST", url: "/v1/identity/scim/Users",
      headers: { ...internalHeaders, authorization: `Bearer ${process.env.SCIM_BEARER_TOKEN}` },
      payload: {
        userName: email,
        name: { givenName: "SCIM", familyName: "Internal" },
      },
    });
    // F3 async: the route publishes and returns 202 with an optimistically
    // built SCIM user representation; the real insert (with a fixed, valid
    // UUID actorId — see scim/commands.ts and scim/consumer.ts) happens in
    // the consumer.
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.schemas).toContain("urn:ietf:params:scim:schemas:core:2.0:User");
    createdUserId = body.id;
    await drainScimQueue();
  });

  it("GET /v1/identity/scim/Users/:id → 200 for created user", async () => {
    if (!createdUserId) return;
    const res = await app.inject({
      method: "GET",
      url: `/v1/identity/scim/Users/${createdUserId}`,
      headers: { ...internalHeaders, authorization: `Bearer ${process.env.SCIM_BEARER_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(createdUserId);
  });

  it("GET /v1/identity/scim/Users/:id → 404 for unknown", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/identity/scim/Users/99999999-9999-4000-8000-999999999999",
      headers: { ...internalHeaders, authorization: `Bearer ${process.env.SCIM_BEARER_TOKEN}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().schemas).toContain("urn:ietf:params:scim:api:messages:2.0:Error");
  });

  it("PUT /v1/identity/scim/Users/:id → 202 accepted, updates user", async () => {
    if (!createdUserId) return;
    const res = await app.inject({
      method: "PUT",
      url: `/v1/identity/scim/Users/${createdUserId}`,
      headers: { ...internalHeaders, authorization: `Bearer ${process.env.SCIM_BEARER_TOKEN}` },
      payload: { userName: "updated-scim@coverage.gov.in", active: true, name: { formatted: "Updated Name" } },
    });
    // F3 async: 202 with an optimistic merge of the existing row + patch; the
    // persisted update happens in the consumer.
    expect(res.statusCode).toBe(202);
    expect(res.json().userName).toBe("updated-scim@coverage.gov.in");
    await drainScimQueue();
  });

  it("PATCH /v1/identity/scim/Users/:id → 202 accepted, patches user", async () => {
    if (!createdUserId) return;
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/identity/scim/Users/${createdUserId}`,
      headers: { ...internalHeaders, authorization: `Bearer ${process.env.SCIM_BEARER_TOKEN}` },
      payload: { Operations: [{ op: "replace", path: "active", value: false }] },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().active).toBe(false);
    await drainScimQueue();
  });

  it("DELETE /v1/identity/scim/Users/:id → 202 accepted, soft-deletes user", async () => {
    if (!createdUserId) return;
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/identity/scim/Users/${createdUserId}`,
      headers: { ...internalHeaders, authorization: `Bearer ${process.env.SCIM_BEARER_TOKEN}` },
    });
    // F3 async: the route publishes a delete/deactivate command and returns
    // 202 with { id, status: "accepted" } — soft-delete (status: "disabled")
    // happens in the consumer, not synchronously, so there is no 204.
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ id: createdUserId, status: "accepted" });
    await drainScimQueue();
  });

  it("GET /v1/identity/scim/Users with filter → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: '/v1/identity/scim/Users?filter=userName eq "nonexist@x.com"',
      headers: { ...internalHeaders, authorization: `Bearer ${process.env.SCIM_BEARER_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().Resources).toBeInstanceOf(Array);
  });

  it("POST /v1/identity/scim/Users with missing email → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/identity/scim/Users",
      headers: { ...internalHeaders, authorization: `Bearer ${process.env.SCIM_BEARER_TOKEN}` },
      payload: { name: { formatted: "No Email" } },
    });
    expect(res.statusCode).toBe(400);
  });
});
