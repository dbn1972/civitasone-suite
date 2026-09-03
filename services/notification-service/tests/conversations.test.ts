/**
 * G5 — Conversation Thread Model route tests.
 *
 * Covers: create conversation, add messages, list by contact, close,
 * cross-tenant isolation, auth (401/403), message pagination.
 *
 * Write routes (POST/PATCH) are async F3 writes (CLAUDE.md rule #3): routes.ts
 * publishes a command and returns 202 Accepted immediately; the actual DB write
 * happens later in consumer.ts. The client never learns the generated id from
 * the 202 response, so tests below tag each created conversation with a unique
 * providerThreadId and poll GET endpoints for the consumer to catch up, then
 * assert against the real, persisted values — same convention as
 * waitForBreachNotification()/waitForFlag() in the admin-service test suite.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerConversationConsumers } from "../src/modules/conversations/consumer.js";
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
  // F3 CONSUMER WIRING — POST/PATCH here go through commands.ts -> queue.publish()
  // and are only ever applied by registerConversationConsumers, which normally
  // runs in src/worker.ts, a process this test never starts. Without registering
  // it against the real in-memory test Queue singleton here, every write stays
  // 202-accepted-and-never-applied, so reads afterwards see nothing. Mirrors
  // registerAllF3Consumers(queue) + queue.start() in admin-service's
  // tests/security-incident.test.ts.
  registerConversationConsumers(queue);
  await queue.start();
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await queue.stop();
  await sqlClient.end();
});

// ─── Async F3 polling helpers ────────────────────────────────────────────────

async function settle(ms = 25): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

type ConversationDTO = {
  id: string;
  tenantId: string;
  contactId: string;
  channel: string;
  status: string;
  subject: string | null;
  providerThreadId: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  closedAt: string | null;
  assignedTo: string | null;
};

type MessageDTO = {
  id: string;
  conversationId: string;
  direction: string;
  content: string | null;
  sentAt: string;
};

/** Waits until a conversation tagged with the given providerThreadId shows up for contactId, and returns its id. */
async function waitForConversationId(
  contactId: string,
  providerThreadId: string,
  authToken: string,
  tries = 40,
): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const res = await app.inject({
      method: "GET",
      url: `/notifications/conversations?contactId=${contactId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    const row = (res.json()?.data as ConversationDTO[] | undefined)?.find(
      (c) => c.providerThreadId === providerThreadId,
    );
    if (row) return row.id;
    await settle();
  }
  throw new Error(`conversation with providerThreadId ${providerThreadId} never landed — F3 consumer not draining`);
}

/**
 * Creates a conversation via the async create endpoint (asserts the 202 accepted
 * envelope), waits for the F3 consumer to persist it, and returns the real id.
 * A providerThreadId is always attached (generated when the caller doesn't pass
 * one) purely as a poll marker — it doesn't change what the route accepts.
 */
async function createConversation(
  payload: { contactId: string; channel: string; subject?: string; providerThreadId?: string; assignedTo?: string },
  authToken = token(),
): Promise<string> {
  const providerThreadId = payload.providerThreadId ?? `test-thread-${randomUUID()}`;
  const res = await app.inject({
    method: "POST",
    url: "/notifications/conversations",
    headers: { authorization: `Bearer ${authToken}` },
    payload: { ...payload, providerThreadId },
  });
  expect(res.statusCode).toBe(202);
  expect(res.json()).toEqual({ accepted: true });
  return waitForConversationId(payload.contactId, providerThreadId, authToken);
}

async function getConversation(id: string, authToken = token()): Promise<ConversationDTO> {
  const res = await app.inject({
    method: "GET",
    url: `/notifications/conversations/${id}`,
    headers: { authorization: `Bearer ${authToken}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

/** Polls the conversation detail until `predicate` matches, then returns the persisted row. */
async function waitForConversation(
  id: string,
  predicate: (c: ConversationDTO) => boolean,
  authToken: string,
  tries = 40,
): Promise<ConversationDTO> {
  for (let i = 0; i < tries; i++) {
    const res = await app.inject({
      method: "GET",
      url: `/notifications/conversations/${id}`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    if (res.statusCode === 200 && predicate(res.json().data)) return res.json().data;
    await settle();
  }
  throw new Error(`conversation ${id} never reached the expected state — F3 consumer not draining`);
}

async function listMessages(conversationId: string, authToken: string): Promise<MessageDTO[]> {
  const res = await app.inject({
    method: "GET",
    url: `/notifications/conversations/${conversationId}/messages?limit=200`,
    headers: { authorization: `Bearer ${authToken}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

/** Polls the message thread until a message with the given content appears, then returns it. */
async function waitForMessage(
  conversationId: string,
  content: string,
  authToken: string,
  tries = 40,
): Promise<MessageDTO> {
  for (let i = 0; i < tries; i++) {
    const msgs = await listMessages(conversationId, authToken);
    const msg = msgs.find((m) => m.content === content);
    if (msg) return msg;
    await settle();
  }
  throw new Error(`message "${content}" in conversation ${conversationId} never landed — F3 consumer not draining`);
}

/** Polls the message thread until it has at least `count` messages. */
async function waitForMessageCount(
  conversationId: string,
  count: number,
  authToken: string,
  tries = 40,
): Promise<MessageDTO[]> {
  for (let i = 0; i < tries; i++) {
    const msgs = await listMessages(conversationId, authToken);
    if (msgs.length >= count) return msgs;
    await settle();
  }
  throw new Error(`conversation ${conversationId} never reached ${count} messages — F3 consumer not draining`);
}

describe("POST /notifications/conversations — create conversation", () => {
  it("returns 202 accepted, and the record is retrievable via GET with the right fields", async () => {
    const tok = token();
    const id = await createConversation({ contactId: CONTACT_1, channel: "whatsapp" }, tok);
    const data = await getConversation(id, tok);
    expect(data.id).toBe(id);
    expect(data.contactId).toBe(CONTACT_1);
    expect(data.channel).toBe("whatsapp");
    expect(data.status).toBe("open");
    expect(data.messageCount).toBe(0);
  });

  it("accepts optional subject and providerThreadId", async () => {
    const tok = token();
    const id = await createConversation(
      { contactId: CONTACT_1, channel: "email", subject: "Order inquiry", providerThreadId: "thread-abc-123" },
      tok,
    );
    const data = await getConversation(id, tok);
    expect(data.subject).toBe("Order inquiry");
    expect(data.providerThreadId).toBe("thread-abc-123");
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
    const tok = token();
    const convoId = await createConversation({ contactId: CONTACT_2, channel: "sms" }, tok);

    const res = await app.inject({
      method: "GET",
      url: `/notifications/conversations?contactId=${CONTACT_2}`,
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    for (const c of body.data) {
      expect(c.contactId).toBe(CONTACT_2);
    }
    expect(body.data.some((c: ConversationDTO) => c.id === convoId)).toBe(true);
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
    const tok = token();
    const id = await createConversation({ contactId: CONTACT_1, channel: "voice" }, tok);

    const res = await app.inject({
      method: "GET",
      url: `/notifications/conversations/${id}`,
      headers: { authorization: `Bearer ${tok}` },
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
  it("creates a message asynchronously, and it's retrievable via GET", async () => {
    const tok = token();
    const convoId = await createConversation({ contactId: CONTACT_1, channel: "webchat" }, tok);

    const res = await app.inject({
      method: "POST",
      url: `/notifications/conversations/${convoId}/messages`,
      headers: { authorization: `Bearer ${tok}` },
      payload: { direction: "inbound", content: "Hello, I need help" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: true });

    const msg = await waitForMessage(convoId, "Hello, I need help", tok);
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
    const tok = token();
    const convoId = await createConversation({ contactId: CONTACT_1, channel: "email" }, tok);

    for (const [direction, content] of [
      ["outbound", "first"],
      ["inbound", "second"],
    ] as const) {
      const res = await app.inject({
        method: "POST",
        url: `/notifications/conversations/${convoId}/messages`,
        headers: { authorization: `Bearer ${tok}` },
        payload: { direction, content },
      });
      expect(res.statusCode).toBe(202);
    }

    const data = await waitForConversation(convoId, (c) => c.messageCount === 2, tok);
    expect(data.messageCount).toBe(2);
    expect(data.lastMessageAt).toBeDefined();
  });

  it("returns 400 for invalid direction", async () => {
    const tok = token();
    const convoId = await createConversation({ contactId: CONTACT_1, channel: "sms" }, tok);

    const res = await app.inject({
      method: "POST",
      url: `/notifications/conversations/${convoId}/messages`,
      headers: { authorization: `Bearer ${tok}` },
      payload: { direction: "sideways", content: "hmm" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /notifications/conversations/:id/messages — list messages", () => {
  it("returns messages in chronological thread (newest first)", async () => {
    const tok = token();
    const convoId = await createConversation({ contactId: CONTACT_1, channel: "whatsapp" }, tok);

    for (const content of ["first", "second", "third"]) {
      const res = await app.inject({
        method: "POST",
        url: `/notifications/conversations/${convoId}/messages`,
        headers: { authorization: `Bearer ${tok}` },
        payload: { direction: "inbound", content },
      });
      expect(res.statusCode).toBe(202);
    }

    await waitForMessageCount(convoId, 3, tok);

    const res = await app.inject({
      method: "GET",
      url: `/notifications/conversations/${convoId}/messages`,
      headers: { authorization: `Bearer ${tok}` },
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
    const tok = token();
    const convoId = await createConversation({ contactId: CONTACT_1, channel: "email" }, tok);

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: `/notifications/conversations/${convoId}/messages`,
        headers: { authorization: `Bearer ${tok}` },
        payload: { direction: i % 2 === 0 ? "inbound" : "outbound", content: `msg-${i}` },
      });
      expect(res.statusCode).toBe(202);
    }

    await waitForMessageCount(convoId, 5, tok);

    const res = await app.inject({
      method: "GET",
      url: `/notifications/conversations/${convoId}/messages?limit=2&offset=0`,
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBe(2);
    expect(res.json().meta.pageSize).toBe(2);
  });
});

describe("PATCH /notifications/conversations/:id — close/archive/assign", () => {
  it("closes a conversation", async () => {
    const tok = token();
    const convoId = await createConversation({ contactId: CONTACT_1, channel: "sms" }, tok);

    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/conversations/${convoId}`,
      headers: { authorization: `Bearer ${tok}` },
      payload: { status: "closed" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: true });

    const data = await waitForConversation(convoId, (c) => c.status === "closed", tok);
    expect(data.status).toBe("closed");
    expect(data.closedAt).toBeDefined();
  });

  it("assigns an agent", async () => {
    const tok = token();
    const agentId = "eeeeeeee-5555-4000-8000-000000000001";
    const convoId = await createConversation({ contactId: CONTACT_1, channel: "webchat" }, tok);

    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/conversations/${convoId}`,
      headers: { authorization: `Bearer ${tok}` },
      payload: { assignedTo: agentId },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: true });

    const data = await waitForConversation(convoId, (c) => c.assignedTo === agentId, tok);
    expect(data.assignedTo).toBe(agentId);
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
    const convoId = await createConversation({ contactId: CONTACT_1, channel: "email" }, token(TENANT_A));

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
