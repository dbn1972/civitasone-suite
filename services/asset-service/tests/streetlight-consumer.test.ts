/**
 * Streetlight consumer — CQRS wiring integration test.
 *
 * Before this: streetlight/routes.ts published commands with no consumer.ts
 * registered — 202 accepted, nothing ever persisted; no `streetlight` schema
 * ever existed in Postgres so GET list/by-id hit "relation does not exist"
 * (500) or came back empty. This suite proves: a real HTTP POST -> consumer
 * -> DB round trip (row actually written), HTTP GET list/by-id return the
 * persisted row (not empty/500), idempotency on redelivery, the fault/request
 * sub-entities work the same way, and cross-tenant RLS isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import {
  assetStreetlights, assetStreetlightFaults, assetStreetlightRequests,
} from "../src/modules/streetlight/schema.js";
import { processed } from "../src/shared/outbox.js";
import { registerStreetlightConsumers } from "../src/modules/streetlight/consumer.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000000e1";
const ACTOR_A  = "cccccccc-3333-4000-8000-0000000000e1";
const TENANT_B = "bbbbbbbb-2222-4000-8000-0000000000e2";
const ACTOR_B  = "dddddddd-4444-4000-8000-0000000000e2";

function token(tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles: ["streetlight_admin", "super_admin"], sid: "s-streetlight" }, SECRET, 3600);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function asTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

let app: FastifyInstance;

beforeAll(async () => {
  // The app's own routes publish to the shared `queue` singleton
  // (shared/infra.ts) — register the consumer on that SAME instance so a
  // real HTTP POST through `app.inject` is actually processed end to end,
  // proving the public API round trip rather than only the internal
  // consumer function.
  registerStreetlightConsumers(appQueue);
  await appQueue.start();
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("Streetlight consumer — CQRS wiring (integration)", () => {
  let streetlightId: string;

  afterAll(async () => {
    await asTenant(TENANT_A, async (tx) => {
      await tx.delete(assetStreetlightFaults).where(eq(assetStreetlightFaults.tenantId, TENANT_A));
      await tx.delete(assetStreetlightRequests).where(eq(assetStreetlightRequests.tenantId, TENANT_A));
      await tx.delete(assetStreetlights).where(eq(assetStreetlights.tenantId, TENANT_A));
    });
  });

  it("POST /v1/assets/streetlights persists a real row (not silently dropped)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/streetlights",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { poleId: `SL-${randomUUID().slice(0, 8)}`, lampType: "led", wattage: 90 },
    });
    expect(res.statusCode).toBe(202);
    streetlightId = res.json().data.id;
    expect(streetlightId).toBeTruthy();

    // give the (in-memory, fire-and-forget) async consumer a beat to process
    await new Promise((r) => setTimeout(r, 300));

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetStreetlights).where(eq(assetStreetlights.id, streetlightId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.wattage).toBe(90);
    expect(rows[0]?.status).toBe("operational");
  });

  it("GET /v1/assets/streetlights returns the persisted row (not empty)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/streetlights",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((s: { id: string }) => s.id === streetlightId)).toBe(true);
  });

  it("GET /v1/assets/streetlights/:id returns the persisted row", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/assets/streetlights/${streetlightId}`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(streetlightId);
  });

  it("unknown id returns 404, not a 500", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/assets/streetlights/${randomUUID()}`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("idempotent: replaying the same messageId does not duplicate", async () => {
    const q = new MemoryQueue();
    registerStreetlightConsumers(q);
    await q.start();
    const id = randomUUID();
    const msgId = randomUUID();
    const publish = () => q.publish(COMMANDS.streetlightCreate, {
      messageId: msgId, type: COMMANDS.streetlightCreate,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "corr-sl-1", schemaVersion: "1.0",
      payload: { id, tenantId: TENANT_A, poleId: `SL-IDEM-${id.slice(0, 8)}`, lampType: "solar", wattage: 40 },
    });
    await publish();
    await new Promise((r) => setTimeout(r, 300));
    await publish(); // replay
    await new Promise((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetStreetlights).where(eq(assetStreetlights.id, id)));
    expect(rows).toHaveLength(1); // still exactly one row

    const seen = await asTenant(TENANT_A, (tx) => tx.select().from(processed).where(eq(processed.messageId, msgId)));
    expect(seen).toHaveLength(1);

    await asTenant(TENANT_A, async (tx) => { await tx.delete(assetStreetlights).where(eq(assetStreetlights.id, id)); });
  });

  it("PATCH .../status applies the update via the consumer", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/streetlights/${streetlightId}/status`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { status: "faulty" },
    });
    expect(res.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 300));

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetStreetlights).where(eq(assetStreetlights.id, streetlightId)));
    expect(rows[0]?.status).toBe("faulty");
  });

  it("fault report + list: POST creates a real fault row, GET list returns it", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/streetlight-faults",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { streetlightId, faultType: "not_working", description: "pole dark at night" },
    });
    expect(res.statusCode).toBe(202);
    const faultId = res.json().data.id;
    await new Promise((r) => setTimeout(r, 300));

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetStreetlightFaults).where(eq(assetStreetlightFaults.id, faultId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.faultNumber).toBeTruthy();
    expect(rows[0]?.status).toBe("reported");

    const listRes = await app.inject({
      method: "GET", url: "/v1/assets/streetlight-faults",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data.some((f: { id: string }) => f.id === faultId)).toBe(true);

    const assignRes = await app.inject({
      method: "PATCH", url: `/v1/assets/streetlight-faults/${faultId}/assign`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { assignedTo: ACTOR_B },
    });
    expect(assignRes.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 300));
    let faultRows = await asTenant(TENANT_A, (tx) => tx.select().from(assetStreetlightFaults).where(eq(assetStreetlightFaults.id, faultId)));
    expect(faultRows[0]?.status).toBe("assigned");
    expect(faultRows[0]?.assignedTo).toBe(ACTOR_B);

    const resolveRes = await app.inject({
      method: "PATCH", url: `/v1/assets/streetlight-faults/${faultId}/resolve`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { resolution: "replaced bulb" },
    });
    expect(resolveRes.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 300));
    faultRows = await asTenant(TENANT_A, (tx) => tx.select().from(assetStreetlightFaults).where(eq(assetStreetlightFaults.id, faultId)));
    expect(faultRows[0]?.status).toBe("resolved");
    expect(faultRows[0]?.resolvedAt).toBeTruthy();
  });

  it("request create + survey + approve: real row, real transitions", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/streetlight-requests",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { requestType: "new_light", justification: "dark stretch of road" },
    });
    expect(res.statusCode).toBe(202);
    const requestId = res.json().data.id;
    await new Promise((r) => setTimeout(r, 300));

    const listRes = await app.inject({
      method: "GET", url: "/v1/assets/streetlight-requests",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data.some((r: { id: string }) => r.id === requestId)).toBe(true);

    const surveyRes = await app.inject({
      method: "POST", url: `/v1/assets/streetlight-requests/${requestId}/survey`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { surveyReport: { feasible: true, poles_needed: 2 } },
    });
    expect(surveyRes.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 300));

    const approveRes = await app.inject({
      method: "POST", url: `/v1/assets/streetlight-requests/${requestId}/approve`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(approveRes.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 300));

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetStreetlightRequests).where(eq(assetStreetlightRequests.id, requestId)));
    expect(rows[0]?.status).toBe("approved");
    expect(rows[0]?.approvedBy).toBe(ACTOR_A);
    expect(rows[0]?.surveyReport).toMatchObject({ feasible: true });
  });
});

describe("Streetlight — cross-tenant RLS isolation", () => {
  const streetlightIdA = randomUUID();

  beforeAll(async () => {
    const q = new MemoryQueue();
    registerStreetlightConsumers(q);
    await q.start();
    await q.publish(COMMANDS.streetlightCreate, {
      messageId: randomUUID(), type: COMMANDS.streetlightCreate,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "corr-rls-sl-1", schemaVersion: "1.0",
      payload: { id: streetlightIdA, tenantId: TENANT_A, poleId: `SL-RLS-${streetlightIdA.slice(0, 8)}`, lampType: "led", wattage: 60 },
    });
    await new Promise((r) => setTimeout(r, 300));
    await q.stop();
  });
  afterAll(async () => {
    await asTenant(TENANT_A, async (tx) => { await tx.delete(assetStreetlights).where(eq(assetStreetlights.id, streetlightIdA)); });
  });

  it("Tenant B cannot see Tenant A's streetlight via GET list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/streetlights",
      headers: { authorization: `Bearer ${token(TENANT_B, ACTOR_B)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((s: { id: string }) => s.id === streetlightIdA)).toBe(false);
  });

  it("Tenant B GET by id returns 404 (not another tenant's row)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/assets/streetlights/${streetlightIdA}`,
      headers: { authorization: `Bearer ${token(TENANT_B, ACTOR_B)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant B's tenant-scoped DB read of Tenant A's row returns zero rows (RLS, not app filter)", async () => {
    const rows = await asTenant(TENANT_B, (tx) => tx.select().from(assetStreetlights).where(and(eq(assetStreetlights.id, streetlightIdA))));
    expect(rows).toHaveLength(0);
  });
});
