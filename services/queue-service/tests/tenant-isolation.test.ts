/**
 * Cross-Tenant Isolation Integration Test — Queue Service
 *
 * Validates: Requirements 1.5, 1.6
 *
 * queue-service holds no tenant-scoped database rows (it brokers messages,
 * it doesn't persist domain resources), so the DB-backed "Tenant A creates a
 * resource, Tenant B reads it → 0 rows / 404" pattern used by the 31
 * DB-backed services doesn't apply verbatim here. The equivalent leak surface
 * for a message bus is: a message published with Tenant A's tenantId must
 * never be delivered, attributed, or routed as if it belonged to Tenant B —
 * and a handler subscribed by one service must not receive another tenant's
 * message mislabeled.
 *
 * This test exercises the in-memory bus (the driver used in test/dev — see
 * QUEUE_DRIVER=memory) plus the queue-service HTTP surface, which is the
 * fully exercisable path in this environment (no live SQS/RabbitMQ broker).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { MemoryQueue, type CommandEnvelope } from "../src/bus.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";

function tokenFor(tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles: ["super_admin"] }, SECRET, 3600);
}

describe("Queue — Cross-Tenant Isolation (MemoryQueue)", () => {
  it("a message published for Tenant A is delivered to the handler tagged with Tenant A's tenantId, never Tenant B's", async () => {
    const q = new MemoryQueue();
    const received: CommandEnvelope[] = [];
    q.subscribe("finance.gl.post", async (msg) => { received.push(msg); });

    await q.publish("finance.gl.post", {
      type: "finance.gl.post",
      tenantId: TENANT_A,
      actorId: "actor-a",
      correlationId: "corr-a",
      schemaVersion: "1.0",
      payload: { amount: 1000 },
    });
    await q.publish("finance.gl.post", {
      type: "finance.gl.post",
      tenantId: TENANT_B,
      actorId: "actor-b",
      correlationId: "corr-b",
      schemaVersion: "1.0",
      payload: { amount: 2000 },
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(2);
    const forA = received.find((m) => m.correlationId === "corr-a");
    const forB = received.find((m) => m.correlationId === "corr-b");
    expect(forA?.tenantId).toBe(TENANT_A);
    expect(forB?.tenantId).toBe(TENANT_B);
    // Neither message ever carries the other tenant's id.
    expect(received.every((m) => m.tenantId === TENANT_A || m.tenantId === TENANT_B)).toBe(true);
  });

  it("a handler subscribed to a topic never receives a message meant for a different topic/tenant pairing", async () => {
    const q = new MemoryQueue();
    const topicAReceived: CommandEnvelope[] = [];
    const topicBReceived: CommandEnvelope[] = [];
    q.subscribe("hrms.leave.create", async (msg) => { topicAReceived.push(msg); });
    q.subscribe("payroll.run.create", async (msg) => { topicBReceived.push(msg); });

    await q.publish("hrms.leave.create", {
      type: "hrms.leave.create",
      tenantId: TENANT_A,
      actorId: "actor-a",
      correlationId: "corr-1",
      schemaVersion: "1.0",
      payload: {},
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(topicAReceived).toHaveLength(1);
    expect(topicBReceived).toHaveLength(0);
  });
});

describe("Queue — Cross-Tenant Isolation (HTTP surface)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("status endpoint does not leak tenant-scoped data regardless of caller's tenant", async () => {
    const resA = await app.inject({
      method: "GET",
      url: "/v1/queue/status",
      headers: { authorization: `Bearer ${tokenFor(TENANT_A, "actor-a")}`, "x-tenant-id": TENANT_A },
    });
    const resB = await app.inject({
      method: "GET",
      url: "/v1/queue/status",
      headers: { authorization: `Bearer ${tokenFor(TENANT_B, "actor-b")}`, "x-tenant-id": TENANT_B },
    });
    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    // The status payload is fleet-wide health info only — no tenant field should
    // ever appear in it (that would indicate tenant-scoped state leaking through
    // a supposedly tenant-agnostic endpoint).
    expect(resA.json()).not.toHaveProperty("tenantId");
    expect(resB.json()).not.toHaveProperty("tenantId");
  });

  it("request without token returns 401", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/queue/status" });
    expect(res.statusCode).toBe(401);
  });
});
