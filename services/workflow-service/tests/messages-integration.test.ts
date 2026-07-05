/**
 * Integration tests for Message Correlation & Signal Broadcast flows.
 *
 * Task 14.3: Message correlation — inject subscription → deliver → verify advance
 * Task 14.4: Signal broadcast — multiple instances resume simultaneously
 *
 * These tests go beyond route coverage: they seed real DB subscriptions and
 * verify the full correlation pipeline via app.inject().
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { messageSubscriptions, signalSubscriptions } from "../src/modules/messages/schema.js";
import { eq, and } from "drizzle-orm";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";
const VALID_UUID = "11111111-2222-4000-8000-333333333333";

function token(roles: string[] = ["workflow_admin"], tenantId = TENANT): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-int" }, SECRET, 3600);
}

function authHeader(roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

// ══════════════════════════════════════════════════════════════════════════════
// TASK 14.3 — Message Correlation Flow Integration
// ══════════════════════════════════════════════════════════════════════════════
describe("Message correlation flow (14.3)", () => {
  const subIds: string[] = [];

  afterEach(async () => {
    // Clean up seeded subscriptions
    for (const id of subIds) {
      await db.delete(messageSubscriptions).where(eq(messageSubscriptions.id, id)).catch(() => undefined);
    }
    subIds.length = 0;
  });

  it("delivers message to an active subscription and returns 202", async () => {
    // Seed an active message subscription
    const subId = randomUUID();
    const instanceId = randomUUID();
    const taskId = randomUUID();
    subIds.push(subId);

    await db.insert(messageSubscriptions).values({
      id: subId,
      tenantId: TENANT,
      instanceId,
      taskId,
      messageName: "payment.confirmed",
      correlationKey: "ORDER-001",
      nodeKey: "catch_payment",
      status: "active",
    });

    // Deliver the message via the route
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      headers: authHeader(["workflow_admin"]),
      payload: {
        messageName: "payment.confirmed",
        correlationKey: "ORDER-001",
        payload: { amount: 5000 },
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBe(subId);
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeDefined();
  });

  it("returns 404 when no active subscription matches the correlation key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      headers: authHeader(["workflow_admin"]),
      payload: {
        messageName: "payment.confirmed",
        correlationKey: "NONEXISTENT-KEY",
        payload: {},
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NO_SUBSCRIPTION");
  });

  it("returns 404 when subscription exists but is not active (already matched)", async () => {
    // Seed a matched (non-active) subscription
    const subId = randomUUID();
    subIds.push(subId);

    await db.insert(messageSubscriptions).values({
      id: subId,
      tenantId: TENANT,
      instanceId: randomUUID(),
      taskId: randomUUID(),
      messageName: "invoice.paid",
      correlationKey: "INV-999",
      nodeKey: "catch_invoice",
      status: "matched",
      matchedAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      headers: authHeader(["workflow_admin"]),
      payload: {
        messageName: "invoice.paid",
        correlationKey: "INV-999",
        payload: {},
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NO_SUBSCRIPTION");
  });

  it("returns 400 when messageName is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      headers: authHeader(["workflow_admin"]),
      payload: { correlationKey: "key-1" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 when correlationKey is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      headers: authHeader(["workflow_admin"]),
      payload: { messageName: "valid.name" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      payload: { messageName: "test.msg", correlationKey: "key-1" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("correlates by tenant — subscription in different tenant not matched", async () => {
    const otherTenant = "bbbbbbbb-2222-4000-8000-000000000002";
    const subId = randomUUID();
    subIds.push(subId);

    // Seed subscription in a DIFFERENT tenant
    await db.insert(messageSubscriptions).values({
      id: subId,
      tenantId: otherTenant,
      instanceId: randomUUID(),
      taskId: randomUUID(),
      messageName: "cross.tenant.msg",
      correlationKey: "CT-001",
      nodeKey: "catch_cross",
      status: "active",
    });

    // Deliver from the test tenant — should not match
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      headers: authHeader(["workflow_admin"]),
      payload: {
        messageName: "cross.tenant.msg",
        correlationKey: "CT-001",
        payload: {},
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NO_SUBSCRIPTION");
  });

  it("verifies subscription is visible via GET subscriptions endpoint", async () => {
    const subId = randomUUID();
    const instanceId = randomUUID();
    subIds.push(subId);

    await db.insert(messageSubscriptions).values({
      id: subId,
      tenantId: TENANT,
      instanceId,
      taskId: randomUUID(),
      messageName: "status.update",
      correlationKey: "STAT-001",
      nodeKey: "catch_status",
      status: "active",
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances/${instanceId}/subscriptions`,
      headers: authHeader(["workflow_user"]),
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].messageName).toBe("status.update");
    expect(data.messages[0].correlationKey).toBe("STAT-001");
    expect(data.messages[0].status).toBe("active");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TASK 14.4 — Signal Broadcast Integration (multiple instances resume)
// ══════════════════════════════════════════════════════════════════════════════
describe("Signal broadcast — multiple instances (14.4)", () => {
  const signalSubIds: string[] = [];

  afterEach(async () => {
    for (const id of signalSubIds) {
      await db.delete(signalSubscriptions).where(eq(signalSubscriptions.id, id)).catch(() => undefined);
    }
    signalSubIds.length = 0;
  });

  it("broadcasts signal and reports matched count for multiple subscribers", async () => {
    // Seed 3 active signal subscriptions for the same signal
    const instanceIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const instanceId of instanceIds) {
      const subId = randomUUID();
      signalSubIds.push(subId);
      await db.insert(signalSubscriptions).values({
        id: subId,
        tenantId: TENANT,
        instanceId,
        taskId: randomUUID(),
        signalName: "shift.change",
        nodeKey: "catch_shift",
        status: "active",
      });
    }

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/signals/broadcast",
      headers: authHeader(["workflow_admin"]),
      payload: {
        signalName: "shift.change",
        payload: { newShift: "morning" },
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.matched).toBe(3);
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeDefined();
  });

  it("broadcasts signal with 0 matched when no subscriptions exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/signals/broadcast",
      headers: authHeader(["workflow_admin"]),
      payload: {
        signalName: "nonexistent.signal",
        payload: {},
      },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().matched).toBe(0);
  });

  it("only matches active subscriptions (not matched/expired)", async () => {
    const sub1Id = randomUUID();
    const sub2Id = randomUUID();
    const sub3Id = randomUUID();
    signalSubIds.push(sub1Id, sub2Id, sub3Id);

    // One active
    await db.insert(signalSubscriptions).values({
      id: sub1Id,
      tenantId: TENANT,
      instanceId: randomUUID(),
      taskId: randomUUID(),
      signalName: "mixed.status.signal",
      nodeKey: "catch_mixed",
      status: "active",
    });

    // One already matched
    await db.insert(signalSubscriptions).values({
      id: sub2Id,
      tenantId: TENANT,
      instanceId: randomUUID(),
      taskId: randomUUID(),
      signalName: "mixed.status.signal",
      nodeKey: "catch_mixed",
      status: "matched",
      matchedAt: new Date(),
    });

    // One expired
    await db.insert(signalSubscriptions).values({
      id: sub3Id,
      tenantId: TENANT,
      instanceId: randomUUID(),
      taskId: randomUUID(),
      signalName: "mixed.status.signal",
      nodeKey: "catch_mixed",
      status: "expired",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/signals/broadcast",
      headers: authHeader(["workflow_admin"]),
      payload: {
        signalName: "mixed.status.signal",
        payload: { reason: "test" },
      },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().matched).toBe(1);
  });

  it("isolates signals by tenant — other tenant subscriptions not matched", async () => {
    const otherTenant = "cccccccc-3333-4000-8000-000000000003";
    const subId = randomUUID();
    signalSubIds.push(subId);

    // Seed subscription in a different tenant
    await db.insert(signalSubscriptions).values({
      id: subId,
      tenantId: otherTenant,
      instanceId: randomUUID(),
      taskId: randomUUID(),
      signalName: "tenant.isolated.signal",
      nodeKey: "catch_isolated",
      status: "active",
    });

    // Broadcast from our test tenant
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/signals/broadcast",
      headers: authHeader(["workflow_admin"]),
      payload: {
        signalName: "tenant.isolated.signal",
        payload: {},
      },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().matched).toBe(0);
  });

  it("returns 400 when signalName is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/signals/broadcast",
      headers: authHeader(["workflow_admin"]),
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns 403 for non-admin role (workflow_user)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/signals/broadcast",
      headers: authHeader(["workflow_user"]),
      payload: { signalName: "test.signal" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/signals/broadcast",
      payload: { signalName: "test.signal" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("verifies signal subscriptions visible via GET subscriptions endpoint", async () => {
    const instanceId = randomUUID();
    const subId = randomUUID();
    signalSubIds.push(subId);

    await db.insert(signalSubscriptions).values({
      id: subId,
      tenantId: TENANT,
      instanceId,
      taskId: randomUUID(),
      signalName: "approval.reminder",
      nodeKey: "catch_reminder",
      status: "active",
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances/${instanceId}/subscriptions`,
      headers: authHeader(["workflow_user"]),
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.signals).toHaveLength(1);
    expect(data.signals[0].signalName).toBe("approval.reminder");
    expect(data.signals[0].status).toBe("active");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/workflow/instances/:instanceId/subscriptions — additional integration
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/workflow/instances/:instanceId/subscriptions (integration)", () => {
  const cleanupIds: { msgs: string[]; sigs: string[] } = { msgs: [], sigs: [] };

  afterEach(async () => {
    for (const id of cleanupIds.msgs) {
      await db.delete(messageSubscriptions).where(eq(messageSubscriptions.id, id)).catch(() => undefined);
    }
    for (const id of cleanupIds.sigs) {
      await db.delete(signalSubscriptions).where(eq(signalSubscriptions.id, id)).catch(() => undefined);
    }
    cleanupIds.msgs.length = 0;
    cleanupIds.sigs.length = 0;
  });

  it("returns 200 with both message and signal subscriptions for an instance", async () => {
    const instanceId = randomUUID();
    const msgSubId = randomUUID();
    const sigSubId = randomUUID();
    cleanupIds.msgs.push(msgSubId);
    cleanupIds.sigs.push(sigSubId);

    await db.insert(messageSubscriptions).values({
      id: msgSubId,
      tenantId: TENANT,
      instanceId,
      taskId: randomUUID(),
      messageName: "doc.received",
      correlationKey: "DOC-001",
      nodeKey: "catch_doc",
      status: "active",
    });

    await db.insert(signalSubscriptions).values({
      id: sigSubId,
      tenantId: TENANT,
      instanceId,
      taskId: randomUUID(),
      signalName: "day.end",
      nodeKey: "catch_dayend",
      status: "active",
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances/${instanceId}/subscriptions`,
      headers: authHeader(["workflow_user"]),
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.messages).toHaveLength(1);
    expect(data.signals).toHaveLength(1);
    expect(data.messages[0].id).toBe(msgSubId);
    expect(data.signals[0].id).toBe(sigSubId);
  });

  it("returns 200 with empty arrays for an instance with no subscriptions", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances/${randomUUID()}/subscriptions`,
      headers: authHeader(["workflow_user"]),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.messages).toEqual([]);
    expect(res.json().data.signals).toEqual([]);
  });

  it("returns 400 for invalid instanceId format", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/instances/not-a-uuid/subscriptions",
      headers: authHeader(["workflow_user"]),
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances/${VALID_UUID}/subscriptions`,
    });

    expect(res.statusCode).toBe(401);
  });
});
