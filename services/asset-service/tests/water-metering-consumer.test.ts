/**
 * Water-metering consumer — CQRS wiring integration test.
 *
 * Before this: water-metering/routes.ts published commands with no
 * consumer.ts registered — 202 accepted, nothing ever persisted; no
 * `water_metering` schema ever existed in Postgres so GET list/by-id hit
 * "relation does not exist" (500). This is the exact gap
 * tests/comp-007-asset-water-smoke.test.ts documented as a KNOWN ISSUE
 * (updated in this same PR). This suite proves: real HTTP POST -> consumer
 * -> DB round trip for readings/bills/service-requests, HTTP GET list/by-id
 * return the persisted rows, idempotency, and cross-tenant RLS isolation.
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
  assetWaterMeterReadings, assetWaterBills, assetWaterServiceRequests,
} from "../src/modules/water-metering/schema.js";
import { processed } from "../src/shared/outbox.js";
import { registerWaterMeteringConsumers } from "../src/modules/water-metering/consumer.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000000f5";
const ACTOR_A  = "cccccccc-3333-4000-8000-0000000000f5";
const TENANT_B = "bbbbbbbb-2222-4000-8000-0000000000f6";
const ACTOR_B  = "dddddddd-4444-4000-8000-0000000000f6";
const CONNECTION_ID = randomUUID(); // no FK to water_connections (see migration note); any uuid is valid here

function token(tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles: ["water_admin", "super_admin"], sid: "s-water-meter" }, SECRET, 3600);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function asTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

let app: FastifyInstance;

beforeAll(async () => {
  registerWaterMeteringConsumers(appQueue);
  await appQueue.start();
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("Water-metering consumer — CQRS wiring (integration)", () => {
  let readingId: string;

  afterAll(async () => {
    await asTenant(TENANT_A, async (tx) => {
      await tx.delete(assetWaterBills).where(eq(assetWaterBills.tenantId, TENANT_A));
      await tx.delete(assetWaterServiceRequests).where(eq(assetWaterServiceRequests.tenantId, TENANT_A));
      await tx.delete(assetWaterMeterReadings).where(eq(assetWaterMeterReadings.tenantId, TENANT_A));
    });
  });

  it("POST /v1/assets/water/readings persists a real row (not silently dropped)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/water/readings",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { connectionId: CONNECTION_ID, readingDate: "2026-09-01", previousReading: "100", currentReading: "142" },
    });
    expect(res.statusCode).toBe(202);
    readingId = res.json().data.id;
    expect(readingId).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300));

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterMeterReadings).where(eq(assetWaterMeterReadings.id, readingId)));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.consumption)).toBeCloseTo(42, 5);
    expect(rows[0]?.status).toBe("pending");
  });

  it("GET /v1/assets/water/readings returns the persisted row (not the KNOWN-ISSUE 500)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/water/readings",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((r: { id: string }) => r.id === readingId)).toBe(true);
  });

  it("a reading where current < previous is rejected by domain validation (no row written)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/water/readings",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { connectionId: CONNECTION_ID, readingDate: "2026-09-05", previousReading: "200", currentReading: "150" },
    });
    const badReadingId = res.json().data.id;
    expect(res.statusCode).toBe(202); // route still accepts (validation is in the consumer)
    await new Promise((r) => setTimeout(r, 300));
    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterMeterReadings).where(eq(assetWaterMeterReadings.id, badReadingId)));
    expect(rows).toHaveLength(0); // rejected before the transaction, never persisted
  });

  it("idempotent: replaying the same messageId does not duplicate", async () => {
    const q = new MemoryQueue();
    registerWaterMeteringConsumers(q);
    await q.start();
    const id = randomUUID();
    const msgId = randomUUID();
    const publish = () => q.publish(COMMANDS.waterMeterReadingRecord, {
      messageId: msgId, type: COMMANDS.waterMeterReadingRecord,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "corr-wm-1", schemaVersion: "1.0",
      payload: { id, tenantId: TENANT_A, connectionId: CONNECTION_ID, readingDate: "2026-09-10", previousReading: "10", currentReading: "25" },
    });
    await publish();
    await new Promise((r) => setTimeout(r, 300));
    await publish(); // replay
    await new Promise((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterMeterReadings).where(eq(assetWaterMeterReadings.id, id)));
    expect(rows).toHaveLength(1);
    const seen = await asTenant(TENANT_A, (tx) => tx.select().from(processed).where(eq(processed.messageId, msgId)));
    expect(seen).toHaveLength(1);

    await asTenant(TENANT_A, async (tx) => { await tx.delete(assetWaterMeterReadings).where(eq(assetWaterMeterReadings.id, id)); });
  });

  it("bill generate persists a real row with computed amounts; GET list/by-id return it", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/water/bills/generate",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { connectionId: CONNECTION_ID, readingId, consumptionKl: 42, ratePerKl: 5000, billingPeriod: "2026-09", dueDate: "2026-10-05" },
    });
    expect(res.statusCode).toBe(202);
    const billId = res.json().data.id;
    await new Promise((r) => setTimeout(r, 300));

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterBills).where(eq(assetWaterBills.id, billId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountMinor).toBe(42n * 5000n);
    expect(rows[0]?.taxMinor).toBe((42n * 5000n * 18n) / 100n);
    expect(rows[0]?.totalMinor).toBe(rows[0]!.amountMinor + rows[0]!.taxMinor);
    expect(rows[0]?.billNumber).toBeTruthy();

    const listRes = await app.inject({
      method: "GET", url: "/v1/assets/water/bills",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data.some((b: { id: string }) => b.id === billId)).toBe(true);

    const getRes = await app.inject({
      method: "GET", url: `/v1/assets/water/bills/${billId}`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.id).toBe(billId);
  });

  it("service request create + resolve: real row, resolution persisted", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/water/service-requests",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { connectionId: CONNECTION_ID, requestType: "leak_repair", description: "leaking near meter box" },
    });
    expect(res.statusCode).toBe(202);
    const requestId = res.json().data.id;
    await new Promise((r) => setTimeout(r, 300));

    const listRes = await app.inject({
      method: "GET", url: "/v1/assets/water/service-requests",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data.some((r: { id: string }) => r.id === requestId)).toBe(true);

    const resolveRes = await app.inject({
      method: "PATCH", url: `/v1/assets/water/service-requests/${requestId}/resolve`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { resolution: "tightened the fitting, leak stopped" },
    });
    expect(resolveRes.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 300));

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterServiceRequests).where(eq(assetWaterServiceRequests.id, requestId)));
    expect(rows[0]?.status).toBe("resolved");
    expect(rows[0]?.resolution).toBe("tightened the fitting, leak stopped");
    expect(rows[0]?.resolvedAt).toBeTruthy();
  });
});

describe("Water-metering — cross-tenant RLS isolation", () => {
  const readingIdA = randomUUID();

  beforeAll(async () => {
    const q = new MemoryQueue();
    registerWaterMeteringConsumers(q);
    await q.start();
    await q.publish(COMMANDS.waterMeterReadingRecord, {
      messageId: randomUUID(), type: COMMANDS.waterMeterReadingRecord,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "corr-rls-wm-1", schemaVersion: "1.0",
      payload: { id: readingIdA, tenantId: TENANT_A, connectionId: CONNECTION_ID, readingDate: "2026-09-15", previousReading: "1", currentReading: "9" },
    });
    await new Promise((r) => setTimeout(r, 300));
    await q.stop();
  });
  afterAll(async () => {
    await asTenant(TENANT_A, async (tx) => { await tx.delete(assetWaterMeterReadings).where(eq(assetWaterMeterReadings.id, readingIdA)); });
  });

  it("Tenant B cannot see Tenant A's reading via GET list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/water/readings",
      headers: { authorization: `Bearer ${token(TENANT_B, ACTOR_B)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((r: { id: string }) => r.id === readingIdA)).toBe(false);
  });

  it("Tenant B's tenant-scoped DB read of Tenant A's row returns zero rows (RLS, not app filter)", async () => {
    const rows = await asTenant(TENANT_B, (tx) => tx.select().from(assetWaterMeterReadings).where(and(eq(assetWaterMeterReadings.id, readingIdA))));
    expect(rows).toHaveLength(0);
  });
});
