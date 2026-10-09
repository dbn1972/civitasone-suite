/**
 * Water-tanker consumer — CQRS wiring integration test.
 *
 * Before this: water-tanker/routes.ts published commands with no consumer.ts
 * registered — 202 accepted, nothing ever persisted; no `water_tanker`
 * schema ever existed in Postgres so GET list/by-id either 500'd or came
 * back silently empty despite the "accepted" write. This suite proves: a
 * real HTTP POST -> consumer -> DB round trip, HTTP GET list/by-id return
 * the persisted row, the full schedule/dispatch/deliver lifecycle,
 * cancellation, idempotency, and cross-tenant RLS isolation.
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
import { assetWaterTankerBookings } from "../src/modules/water-tanker/schema.js";
import { processed } from "../src/shared/outbox.js";
import { registerWaterTankerConsumers } from "../src/modules/water-tanker/consumer.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";
import { drainOrFail } from "../../../vitest.drain";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000000f7";
const ACTOR_A  = "cccccccc-3333-4000-8000-0000000000f7";
const TENANT_B = "bbbbbbbb-2222-4000-8000-0000000000f8";
const ACTOR_B  = "dddddddd-4444-4000-8000-0000000000f8";

function token(tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles: ["water_operator", "super_admin"], sid: "s-water-tanker" }, SECRET, 3600);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function asTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

let app: FastifyInstance;

beforeAll(async () => {
  registerWaterTankerConsumers(appQueue);
  await appQueue.start();
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("Water-tanker consumer — CQRS wiring (integration)", () => {
  let bookingId: string;

  afterAll(async () => {
    await asTenant(TENANT_A, async (tx) => {
      await tx.delete(assetWaterTankerBookings).where(eq(assetWaterTankerBookings.tenantId, TENANT_A));
    });
  });

  it("POST /v1/assets/water/tanker-bookings persists a real row (not silently dropped)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/water/tanker-bookings",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { tankerCapacityLitres: 10000, requestedDate: "2026-10-01", ward: "Ward-7" },
    });
    expect(res.statusCode).toBe(202);
    bookingId = res.json().data.id;
    expect(bookingId).toBeTruthy();
    await drainOrFail(appQueue);

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterTankerBookings).where(eq(assetWaterTankerBookings.id, bookingId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("requested");
    expect(rows[0]?.tankerCapacityLitres).toBe(10000);
    expect(rows[0]?.feeMinor).toBe(900_00n); // 10000L per CAPACITY_FEES
    expect(rows[0]?.bookingNumber).toBeTruthy();
  });

  it("GET /v1/assets/water/tanker-bookings returns the persisted row (not empty)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/water/tanker-bookings",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((b: { id: string }) => b.id === bookingId)).toBe(true);
  });

  it("GET /v1/assets/water/tanker-bookings/:id returns the persisted row", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/assets/water/tanker-bookings/${bookingId}`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(bookingId);
  });

  it("unknown id returns 404, not a 500", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/assets/water/tanker-bookings/${randomUUID()}`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("idempotent: replaying the same messageId does not duplicate", async () => {
    const q = new MemoryQueue();
    registerWaterTankerConsumers(q);
    await q.start();
    const id = randomUUID();
    const msgId = randomUUID();
    const publish = () => q.publish(COMMANDS.waterTankerBookingCreate, {
      messageId: msgId, type: COMMANDS.waterTankerBookingCreate,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "corr-wt-1", schemaVersion: "1.0",
      payload: { id, tenantId: TENANT_A, tankerCapacityLitres: 5000, requestedDate: "2026-10-02" },
    });
    await publish();
    await drainOrFail(q);
    await publish(); // replay
    await drainOrFail(q);
    await q.stop();

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterTankerBookings).where(eq(assetWaterTankerBookings.id, id)));
    expect(rows).toHaveLength(1);
    const seen = await asTenant(TENANT_A, (tx) => tx.select().from(processed).where(eq(processed.messageId, msgId)));
    expect(seen).toHaveLength(1);

    await asTenant(TENANT_A, async (tx) => { await tx.delete(assetWaterTankerBookings).where(eq(assetWaterTankerBookings.id, id)); });
  });

  it("schedule -> dispatch -> deliver persists each transition", async () => {
    const scheduleRes = await app.inject({
      method: "POST", url: `/v1/assets/water/tanker-bookings/${bookingId}/schedule`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { scheduledDate: "2026-10-02", tankerVehicleId: "TANKER-07" },
    });
    expect(scheduleRes.statusCode).toBe(202);
    await drainOrFail(appQueue);
    let rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterTankerBookings).where(eq(assetWaterTankerBookings.id, bookingId)));
    expect(rows[0]?.status).toBe("scheduled");
    expect(rows[0]?.tankerVehicleId).toBe("TANKER-07");

    const dispatchRes = await app.inject({
      method: "POST", url: `/v1/assets/water/tanker-bookings/${bookingId}/dispatch`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(dispatchRes.statusCode).toBe(202);
    await drainOrFail(appQueue);
    rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterTankerBookings).where(eq(assetWaterTankerBookings.id, bookingId)));
    expect(rows[0]?.status).toBe("dispatched");
    expect(rows[0]?.dispatchedAt).toBeTruthy();

    const deliverRes = await app.inject({
      method: "POST", url: `/v1/assets/water/tanker-bookings/${bookingId}/deliver`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(deliverRes.statusCode).toBe(202);
    await drainOrFail(appQueue);
    rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterTankerBookings).where(eq(assetWaterTankerBookings.id, bookingId)));
    expect(rows[0]?.status).toBe("delivered");
    expect(rows[0]?.deliveredAt).toBeTruthy();
  });

  it("cancel persists the cancelled status", async () => {
    const createRes = await app.inject({
      method: "POST", url: "/v1/assets/water/tanker-bookings",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
      payload: { tankerCapacityLitres: 15000, requestedDate: "2026-10-03" },
    });
    const cancelBookingId = createRes.json().data.id;
    await drainOrFail(appQueue);

    const cancelRes = await app.inject({
      method: "POST", url: `/v1/assets/water/tanker-bookings/${cancelBookingId}/cancel`,
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(cancelRes.statusCode).toBe(202);
    await drainOrFail(appQueue);

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(assetWaterTankerBookings).where(eq(assetWaterTankerBookings.id, cancelBookingId)));
    expect(rows[0]?.status).toBe("cancelled");
  });
});

describe("Water-tanker — cross-tenant RLS isolation", () => {
  const bookingIdA = randomUUID();

  beforeAll(async () => {
    const q = new MemoryQueue();
    registerWaterTankerConsumers(q);
    await q.start();
    await q.publish(COMMANDS.waterTankerBookingCreate, {
      messageId: randomUUID(), type: COMMANDS.waterTankerBookingCreate,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "corr-rls-wt-1", schemaVersion: "1.0",
      payload: { id: bookingIdA, tenantId: TENANT_A, tankerCapacityLitres: 5000, requestedDate: "2026-10-04" },
    });
    await drainOrFail(q);
    await q.stop();
  });
  afterAll(async () => {
    await asTenant(TENANT_A, async (tx) => { await tx.delete(assetWaterTankerBookings).where(eq(assetWaterTankerBookings.id, bookingIdA)); });
  });

  it("Tenant B cannot see Tenant A's booking via GET list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/water/tanker-bookings",
      headers: { authorization: `Bearer ${token(TENANT_B, ACTOR_B)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((b: { id: string }) => b.id === bookingIdA)).toBe(false);
  });

  it("Tenant B GET by id returns 404 (not another tenant's row)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/assets/water/tanker-bookings/${bookingIdA}`,
      headers: { authorization: `Bearer ${token(TENANT_B, ACTOR_B)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant B's tenant-scoped DB read of Tenant A's row returns zero rows (RLS, not app filter)", async () => {
    const rows = await asTenant(TENANT_B, (tx) => tx.select().from(assetWaterTankerBookings).where(and(eq(assetWaterTankerBookings.id, bookingIdA))));
    expect(rows).toHaveLength(0);
  });
});
