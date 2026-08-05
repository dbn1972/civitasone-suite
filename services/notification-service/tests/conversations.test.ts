/**
 * G5 — Conversation Thread Model route tests.
 *
 * Covers: create conversation, add messages, list by contact, close,
 * cross-tenant isolation, auth (401/403), message pagination.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-1111-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-2222-4000-8000-000000000002";
const ACTOR = "cccccccc-3333-4000-8000-000000000001";
const CONTACT_1 = "dddddddd-4444-4000-8000-000000000001";
const CONTACT_2 = "dddddddd-4444-4000-8000-000000000002";

function token(tenantId = TENANT_A, roles = ["notification_user"]) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-conv-1" }, SECRET);
}

function adminToken(tenantId = TENANT_A) {
  return token(tenantId, ["notification_admin"]);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("POST /notifications/conversations — create conversation", () => {
  it("returns 201 with id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { contactId: CONTACT_1, channel: "whatsapp" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.id).toBeDefined();
    expect(body.data.contactId).toBe(CONTACT_1);
    expect(body.data.channel).toBe("whatsapp");
    expect(body.data.status).toBe("open");
    expect(body.data.messageCount).toBe(0);
  });

  it("accepts optional subject and providerThreadId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { contactId: CONTACT_1, channel: "email", subject: "Order inquiry", providerThreadId: "thread-abc-123" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.subject).toBe("Order inquiry");
    expect(body.data.providerThreadId).toBe("thread-abc-123");
  });

  it("returns 400 for invalid channel", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { contactId: CONTACT_1, channel: "telegram" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing contactId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { channel: "sms" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /notifications/conversations — list", () => {
  it("returns conversations as array in data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
  });

  it("filters by contactId", async () => {
    // Create a conversation for contact_2
    await app.inject({
      method: "POST",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { contactId: CONTACT_2, channel: "sms" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/notifications/conversations?contactId=${CONTACT_2}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    for (const c of body.data) {
      expect(c.contactId).toBe(CONTACT_2);
    }
  });

  it("filters by channel", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/notifications/conversations?channel=whatsapp",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    for (const c of res.json().data) {
      expect(c.channel).toBe("whatsapp");
    }
  });

  it("filters by status", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/notifications/conversations?status=open",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    for (const c of res.json().data) {
      expect(c.status).toBe("open");
    }
  });
});

describe("GET /notifications/conversations/:id — detail", () => {
  it("returns conversation by id", async () => {
    // Create one first
    const createRes = await app.inject({
      method: "POST",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { contactId: CONTACT_1, channel: "voice" },
    });
    const id = createRes.json().data.id;

    const res = await app.inject({
      method: "GET",
      url: `/notifications/conversations/${id}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(id);
    expect(res.json().data.channel).toBe("voice");
  });

  it("returns 404 for non-existent conversation", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/notifications/conversations/00000000-0000-4000-8000-000000000099",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /notifications/conversations/:id/messages — add message", () => {
  it("creates a message and returns 201", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { contactId: CONTACT_1, channel: "webchat" },
    });
    const convoId = createRes.json().data.id;

    const res = await app.inject({
      method: "POST",
      url: `/notifications/conversations/${convoId}/messages`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { direction: "inbound", content: "Hello, I need help" },
    });
    expect(res.statusCode).toBe(201);
    const msg = res.json().data;
    expect(msg.id).toBeDefined();
    expect(msg.direction).toBe("inbound");
    expect(msg.content).toBe("Hello, I need help");
    expect(msg.conversationId).toBe(convoId);
  });

  it("returns 404 for non-existent conversation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/notifications/conversations/00000000-0000-4000-8000-000000000099/messages",
      headers: { authorization: `Bearer ${token()}` },
      payload: { direction: "outbound", content: "response" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("increments messageCount on conversation", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { contactId: CONTACT_1, channel: "email" },
    });
    const convoId = createRes.json().data.id;

    await app.inject({
      method: "POST",
      url: `/notifications/conversations/${convoId}/messages`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { direction: "outbound", content: "first" },
    });
    await app.inject({
      method: "POST",
      url: `/notifications/conversations/${convoId}/messages`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { direction: "inbound", content: "second" },
    });

    const detailRes = await app.inject({
      method: "GET",
      url: `/notifications/conversations/${convoId}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(detailRes.json().data.messageCount).toBe(2);
    expect(detailRes.json().data.lastMessageAt).toBeDefined();
  });

  it("returns 400 for invalid direction", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { contactId: CONTACT_1, channel: "sms" },
    });
    const convoId = createRes.json().data.id;

    const res = await app.inject({
      method: "POST",
      url: `/notifications/conversations/${convoId}/messages`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { direction: "sideways", content: "hmm" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /notifications/conversations/:id/messages — list messages", () => {
  it("returns messages in chronological thread (newest first)", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { contactId: CONTACT_1, channel: "whatsapp" },
    });
    const convoId = createRes.json().data.id;

    // Add 3 messages
    for (const content of ["first", "second", "third"]) {
      await app.inject({
        method: "POST",
        url: `/notifications/conversations/${convoId}/messages`,
        headers: { authorization: `Bearer ${token()}` },
        payload: { direction: "inbound", content },
      });
    }

    const res = await app.inject({
      method: "GET",
      url: `/notifications/conversations/${convoId}/messages`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBe(3);
    // Newest first: sentAt[0] >= sentAt[1] >= sentAt[2]
    for (let i = 0; i < body.data.length - 1; i++) {
      expect(new Date(body.data[i].sentAt).getTime()).toBeGreaterThanOrEqual(
        new Date(body.data[i + 1].sentAt).getTime(),
      );
    }
  });

  it("supports pagination with limit and offset", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { contactId: CONTACT_1, channel: "email" },
    });
    const convoId = createRes.json().data.id;

    // Add 5 messages
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: `/notifications/conversations/${convoId}/messages`,
        headers: { authorization: `Bearer ${token()}` },
        payload: { direction: i % 2 === 0 ? "inbound" : "outbound", content: `msg-${i}` },
      });
    }

    const res = await app.inject({
      method: "GET",
      url: `/notifications/conversations/${convoId}/messages?limit=2&offset=0`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBe(2);
    expect(res.json().meta.pageSize).toBe(2);
  });
});

describe("PATCH /notifications/conversations/:id — close/archive/assign", () => {
  it("closes a conversation", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { contactId: CONTACT_1, channel: "sms" },
    });
    const convoId = createRes.json().data.id;

    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/conversations/${convoId}`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { status: "closed" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("closed");
    expect(res.json().data.closedAt).toBeDefined();
  });

  it("assigns an agent", async () => {
    const agentId = "eeeeeeee-5555-4000-8000-000000000001";
    const createRes = await app.inject({
      method: "POST",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { contactId: CONTACT_1, channel: "webchat" },
    });
    const convoId = createRes.json().data.id;

    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/conversations/${convoId}`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { assignedTo: agentId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.assignedTo).toBe(agentId);
  });

  it("returns 404 for non-existent conversation", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/notifications/conversations/00000000-0000-4000-8000-000000000099",
      headers: { authorization: `Bearer ${token()}` },
      payload: { status: "closed" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Cross-tenant isolation", () => {
  it("tenant B cannot see tenant A conversations", async () => {
    // Create conversation in tenant A
    const createRes = await app.inject({
      method: "POST",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token(TENANT_A)}` },
      payload: { contactId: CONTACT_1, channel: "email" },
    });
    const convoId = createRes.json().data.id;

    // Tenant B tries to access it
    const res = await app.inject({
      method: "GET",
      url: `/notifications/conversations/${convoId}`,
      headers: { authorization: `Bearer ${token(TENANT_B)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B list does not include tenant A conversations", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${token(TENANT_B)}` },
    });
    expect(res.statusCode).toBe(200);
    // Tenant B should have no conversations (all created by tenant A in this test)
    for (const c of res.json().data) {
      expect(c.tenantId).toBe(TENANT_B);
    }
  });
});

describe("Auth: 401/403", () => {
  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/notifications/conversations",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for role without access", async () => {
    const noAccessToken = signToken(
      { sub: ACTOR, tid: TENANT_A, roles: ["employee"], sid: "sess-conv-2" },
      SECRET,
    );
    const res = await app.inject({
      method: "GET",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${noAccessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("helpdesk_user role has access", async () => {
    const helpdeskToken = signToken(
      { sub: ACTOR, tid: TENANT_A, roles: ["helpdesk_user"], sid: "sess-conv-3" },
      SECRET,
    );
    const res = await app.inject({
      method: "GET",
      url: "/notifications/conversations",
      headers: { authorization: `Bearer ${helpdeskToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
