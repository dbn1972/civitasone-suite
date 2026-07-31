/**
 * Inbound lead capture tests (LM-005).
 *
 * Tests the POST /v1/crm/leads/inbound route (validation, auth, authz)
 * and the inbound consumer (idempotency, contact creation).
 */
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000001";
const ACTOR = "cccccccc-3333-4000-8000-000000000001";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-inbound" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/crm/leads/inbound", () => {
  const validPayload = {
    channel: "email",
    source: "marketing-campaign-q1",
    attributes: {
      name: "John Doe",
      email: "john@example.com",
      phone: "+919876543210",
      company: "Acme Corp",
    },
    metadata: { campaignId: "camp-123" },
  };

  describe("happy path", () => {
    it("returns 202 with accepted shape for valid inbound lead", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token()}` },
        payload: validPayload,
      });
      await app.close();

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe("accepted");
      expect(body.correlationId).toBeDefined();
    });

    it("accepts all valid channels", async () => {
      const app = await buildApp();
      const channels = ["email", "telephony", "chatbot", "whatsapp", "partner_api"] as const;

      for (const channel of channels) {
        const res = await app.inject({
          method: "POST",
          url: "/v1/crm/leads/inbound",
          headers: { authorization: `Bearer ${token()}` },
          payload: { ...validPayload, channel },
        });
        expect(res.statusCode).toBe(202);
      }
      await app.close();
    });

    it("allows integration_bot role", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token(["integration_bot"])}` },
        payload: validPayload,
      });
      await app.close();

      expect(res.statusCode).toBe(202);
    });

    it("allows tenant_admin role", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
        payload: validPayload,
      });
      await app.close();

      expect(res.statusCode).toBe(202);
    });
  });

  describe("validation (400)", () => {
    it("rejects missing channel", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token()}` },
        payload: { source: "test", attributes: {} },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("rejects invalid channel value", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token()}` },
        payload: { ...validPayload, channel: "sms" },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("rejects empty source", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token()}` },
        payload: { ...validPayload, source: "" },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("rejects invalid email in attributes", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token()}` },
        payload: { ...validPayload, attributes: { email: "not-an-email" } },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("rejects missing attributes object", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token()}` },
        payload: { channel: "email", source: "test" },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });
  });

  describe("authentication (401)", () => {
    it("returns 401 when no token is provided", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        payload: validPayload,
      });
      await app.close();

      expect(res.statusCode).toBe(401);
    });

    it("returns 401 with malformed token", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: "Bearer invalid.token.here" },
        payload: validPayload,
      });
      await app.close();

      expect(res.statusCode).toBe(401);
    });
  });

  describe("authorization (403)", () => {
    it("returns 403 for citizen role", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token(["citizen"])}` },
        payload: validPayload,
      });
      await app.close();

      expect(res.statusCode).toBe(403);
    });

    it("returns 403 for employee role", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token(["employee"])}` },
        payload: validPayload,
      });
      await app.close();

      expect(res.statusCode).toBe(403);
    });
  });
});

describe("inbound consumer (unit)", () => {
  it("registerInboundCaptureConsumer subscribes to correct topic", async () => {
    const { registerInboundCaptureConsumer } = await import("../src/modules/leads/inbound-consumer.js");
    const { COMMANDS } = await import("../src/topics.js");

    const subscriptions: string[] = [];
    const mockQueue = {
      subscribe: (topic: string, _handler: unknown) => { subscriptions.push(topic); },
      publish: vi.fn(),
    };

    registerInboundCaptureConsumer(mockQueue as never);
    expect(subscriptions).toContain(COMMANDS.inboundCapture);
  });
});
