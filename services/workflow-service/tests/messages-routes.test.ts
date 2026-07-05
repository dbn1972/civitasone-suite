/**
 * Messages module — route + domain coverage tests.
 *
 * Covers: POST /v1/workflow/messages/deliver, POST /v1/workflow/signals/broadcast,
 * GET /v1/workflow/instances/:instanceId/subscriptions, domain logic, and auth.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = "00000000-aaaa-4000-8000-000000000099";
const VALID_UUID = "11111111-2222-4000-8000-333333333333";

function token(roles: string[] = ["workflow_admin"], tenantId = TENANT): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-001" }, SECRET, 3600);
}

function authHeader(roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/workflow/messages/deliver
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/workflow/messages/deliver", () => {
  it("returns 404 when no active subscription exists", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      headers: authHeader(["workflow_admin"]),
      payload: {
        messageName: "payment.confirmed",
        correlationKey: "order-12345",
        payload: { amount: 1000 },
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NO_SUBSCRIPTION");
  });

  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      headers: authHeader(["workflow_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 with invalid messageName (starts with number)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      headers: authHeader(["workflow_admin"]),
      payload: { messageName: "123invalid", correlationKey: "key-1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with empty messageName", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      headers: authHeader(["workflow_admin"]),
      payload: { messageName: "", correlationKey: "key-1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with empty correlationKey", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      headers: authHeader(["workflow_admin"]),
      payload: { messageName: "valid.name", correlationKey: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for citizen role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      headers: authHeader(["citizen"]),
      payload: { messageName: "test.msg", correlationKey: "key-1" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      payload: { messageName: "test.msg", correlationKey: "key-1" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts valid message name patterns", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      headers: authHeader(["workflow_user"]),
      payload: {
        messageName: "invoice.payment-confirmed_v2",
        correlationKey: "INV-2026-001",
        payload: { status: "paid" },
      },
    });
    // 404 = no subscription (but validates + passes auth)
    expect(res.statusCode).toBe(404);
  });

  it("super_admin can deliver messages", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/messages/deliver",
      headers: authHeader(["super_admin"]),
      payload: { messageName: "test.event", correlationKey: "abc" },
    });
    expect(res.statusCode).toBe(404); // no subscription, but auth passes
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/workflow/signals/broadcast
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/workflow/signals/broadcast", () => {
  it("returns 202 with matched=0 when no subscriptions exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/signals/broadcast",
      headers: authHeader(["workflow_admin"]),
      payload: {
        signalName: "shift.change",
        payload: { newShift: "night" },
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().matched).toBe(0);
    expect(res.json().status).toBe("accepted");
  });

  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/signals/broadcast",
      headers: authHeader(["workflow_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid signalName", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/signals/broadcast",
      headers: authHeader(["workflow_admin"]),
      payload: { signalName: "123bad" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with empty signalName", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/signals/broadcast",
      headers: authHeader(["workflow_admin"]),
      payload: { signalName: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for workflow_user (broadcast requires admin)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/signals/broadcast",
      headers: authHeader(["workflow_user"]),
      payload: { signalName: "test.signal" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for citizen role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/signals/broadcast",
      headers: authHeader(["citizen"]),
      payload: { signalName: "test.signal" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/signals/broadcast",
      payload: { signalName: "test.signal" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("super_admin can broadcast signals", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/signals/broadcast",
      headers: authHeader(["super_admin"]),
      payload: { signalName: "emergency.shutdown", payload: { reason: "fire alarm" } },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().matched).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/workflow/instances/:instanceId/subscriptions
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/workflow/instances/:instanceId/subscriptions", () => {
  it("returns 200 with empty arrays for unknown instance", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances/${VALID_UUID}/subscriptions`,
      headers: authHeader(["workflow_user"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.messages).toEqual([]);
    expect(res.json().data.signals).toEqual([]);
  });

  it("returns 400 for invalid uuid", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/instances/not-a-uuid/subscriptions",
      headers: authHeader(["workflow_user"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for citizen role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances/${VALID_UUID}/subscriptions`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances/${VALID_UUID}/subscriptions`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("super_admin can view subscriptions", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances/${VALID_UUID}/subscriptions`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DOMAIN LOGIC
// ══════════════════════════════════════════════════════════════════════════════
describe("Messages domain logic", () => {
  it("validates message names", async () => {
    const { assertValidMessageName, DomainError } = await import("../src/modules/messages/domain.js");

    // Valid names
    expect(() => assertValidMessageName("payment.confirmed")).not.toThrow();
    expect(() => assertValidMessageName("invoice_received")).not.toThrow();
    expect(() => assertValidMessageName("order-status-v2")).not.toThrow();
    expect(() => assertValidMessageName("a")).not.toThrow();

    // Invalid names
    expect(() => assertValidMessageName("")).toThrow();
    expect(() => assertValidMessageName("123abc")).toThrow();
    expect(() => assertValidMessageName(" space")).toThrow();
    expect(() => assertValidMessageName("a".repeat(129))).toThrow();
  });

  it("validates signal names", async () => {
    const { assertValidSignalName } = await import("../src/modules/messages/domain.js");

    expect(() => assertValidSignalName("shift.change")).not.toThrow();
    expect(() => assertValidSignalName("emergency_shutdown")).not.toThrow();

    expect(() => assertValidSignalName("")).toThrow();
    expect(() => assertValidSignalName("1bad")).toThrow();
  });

  it("validates correlation keys", async () => {
    const { assertValidCorrelationKey } = await import("../src/modules/messages/domain.js");

    expect(() => assertValidCorrelationKey("order-123")).not.toThrow();
    expect(() => assertValidCorrelationKey("INV/2026/001")).not.toThrow();

    expect(() => assertValidCorrelationKey("")).toThrow();
    expect(() => assertValidCorrelationKey("x".repeat(257))).toThrow();
  });

  it("resolves correlation key from context", async () => {
    const { resolveCorrelationKey } = await import("../src/modules/messages/domain.js");

    expect(resolveCorrelationKey("orderId", { orderId: "ORD-123" })).toBe("ORD-123");
    expect(resolveCorrelationKey("request.id", { request: { id: "REQ-456" } })).toBe("REQ-456");
    expect(resolveCorrelationKey("num", { num: 42 })).toBe("42");
  });

  it("throws on unresolvable correlation key", async () => {
    const { resolveCorrelationKey } = await import("../src/modules/messages/domain.js");

    expect(() => resolveCorrelationKey("missing", {})).toThrow();
    expect(() => resolveCorrelationKey("deep.path", { deep: null })).toThrow();
  });

  it("computes timeout correctly", async () => {
    const { computeTimeoutAt } = await import("../src/modules/messages/domain.js");

    const now = new Date("2026-01-01T00:00:00Z");
    expect(computeTimeoutAt(null)).toBeNull();
    expect(computeTimeoutAt(undefined)).toBeNull();
    expect(computeTimeoutAt(0)).toBeNull();
    expect(computeTimeoutAt(-1)).toBeNull();

    const result = computeTimeoutAt(60, now);
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(now.getTime() + 60 * 60_000);
  });

  it("checks expiry correctly", async () => {
    const { isExpired } = await import("../src/modules/messages/domain.js");

    const past = new Date("2020-01-01T00:00:00Z");
    const future = new Date("2099-01-01T00:00:00Z");
    const now = new Date();

    expect(isExpired(null)).toBe(false);
    expect(isExpired(past, now)).toBe(true);
    expect(isExpired(future, now)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TOPICS CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════
describe("Messages topics constants", () => {
  it("exports message/signal commands", async () => {
    const { COMMANDS } = await import("../src/topics.js");
    expect(COMMANDS.deliverMessage).toBe("workflow.message.deliver");
    expect(COMMANDS.broadcastSignal).toBe("workflow.signal.broadcast");
  });

  it("exports message/signal events", async () => {
    const { EVENTS } = await import("../src/topics.js");
    expect(EVENTS.messageDelivered).toBe("workflow.message.delivered");
    expect(EVENTS.signalDelivered).toBe("workflow.signal.delivered");
    expect(EVENTS.messageTimeout).toBe("workflow.message.timeout");
  });
});
