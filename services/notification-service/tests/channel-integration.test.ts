/**
 * Channel Integration Tests — CH-06, CH-07, CH-09
 * CRM Timeline, Inbound Messages, Convert Conversation to Ticket
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000070";
const ACTOR = "cccccccc-3333-4000-8000-000000000070";
const CONV_ID = "dddddddd-4444-4000-8000-000000000070";

function token(roles = ["notification_admin"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

// --------------- CH-06: CRM Timeline ---------------

describe("POST /v1/notification/channels/crm-timeline (CH-06)", () => {
  it("returns 202 with valid delivery event payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notification/channels/crm-timeline",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        deliveryId: "11111111-1111-4000-8000-000000000001",
        channel: "email",
        status: "delivered",
        recipient: "user@example.com",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeDefined();
  });

  it("returns 202 with optional fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notification/channels/crm-timeline",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        deliveryId: "11111111-1111-4000-8000-000000000002",
        channel: "sms",
        status: "opened",
        recipient: "+919999999999",
        contactId: "22222222-2222-4000-8000-000000000001",
        campaignId: "33333333-3333-4000-8000-000000000001",
        metadata: { source: "campaign-blast" },
        occurredAt: "2025-01-15T10:00:00Z",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 for missing required fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notification/channels/crm-timeline",
      headers: { authorization: `Bearer ${token()}` },
      payload: { channel: "email" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid channel enum", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notification/channels/crm-timeline",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        deliveryId: "11111111-1111-4000-8000-000000000003",
        channel: "pigeon",
        status: "delivered",
        recipient: "user@example.com",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notification/channels/crm-timeline",
      payload: {
        deliveryId: "11111111-1111-4000-8000-000000000004",
        channel: "email",
        status: "delivered",
        recipient: "user@example.com",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notification/channels/crm-timeline",
      headers: { authorization: `Bearer ${token(["employee"])}` },
      payload: {
        deliveryId: "11111111-1111-4000-8000-000000000005",
        channel: "email",
        status: "delivered",
        recipient: "user@example.com",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// --------------- CH-07: Inbound Messages ---------------

describe("POST /v1/notification/inbox/inbound (CH-07)", () => {
  it("returns 202 with valid inbound message", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notification/inbox/inbound",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        channel: "email",
        from: "customer@example.com",
        body: "I need help with my order",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("returns 202 with metadata", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notification/inbox/inbound",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        channel: "whatsapp",
        from: "+919876543210",
        body: "What is the status of my application?",
        metadata: { messageId: "wa-12345", mediaUrl: null },
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 for empty body field", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notification/inbox/inbound",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        channel: "email",
        from: "customer@example.com",
        body: "",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notification/inbox/inbound",
      payload: { channel: "email", from: "a@b.com", body: "hello" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notification/inbox/inbound",
      headers: { authorization: `Bearer ${token(["employee"])}` },
      payload: { channel: "email", from: "a@b.com", body: "hello" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// --------------- CH-09: Convert Conversation to Ticket ---------------

describe("POST /v1/notification/inbox/:conversationId/convert-to-ticket (CH-09)", () => {
  it("returns 202 with valid subject", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/notification/inbox/${CONV_ID}/convert-to-ticket`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { subject: "Customer needs assistance with login" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("returns 202 with priority and category", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/notification/inbox/${CONV_ID}/convert-to-ticket`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { subject: "Urgent billing issue", priority: "high", category: "billing" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 for empty subject", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/notification/inbox/${CONV_ID}/convert-to-ticket`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { subject: "" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid conversationId (not uuid)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notification/inbox/not-a-uuid/convert-to-ticket",
      headers: { authorization: `Bearer ${token()}` },
      payload: { subject: "test" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/notification/inbox/${CONV_ID}/convert-to-ticket`,
      payload: { subject: "test" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/notification/inbox/${CONV_ID}/convert-to-ticket`,
      headers: { authorization: `Bearer ${token(["citizen"])}` },
      payload: { subject: "test" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
