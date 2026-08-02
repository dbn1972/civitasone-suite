/**
 * MT-006 — web push + in-app messaging routes and consumer.
 *
 * Two things matter beyond the usual authz grid: the device token (a bearer
 * credential) must never come back in a response, and a normal user must not be
 * able to register a device or read an inbox on behalf of somebody else.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, sql, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { blindIndex } from "../src/shared/pii-crypto.js";
import { pushSubscriptions, inAppMessages } from "../src/modules/push/schema.js";
import { registerPushConsumers } from "../src/modules/push/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "cccc0001-1111-4000-8000-000000000001";
const ACTOR = "ccccaaaa-1111-4000-8000-0000000000aa";
const OTHER_USER = "ccccbbbb-2222-4000-8000-0000000000bb";
const SUB_ID = "cccc1111-1111-4000-8000-000000000011";
const MSG_ID = "cccc2222-1111-4000-8000-000000000022";
const UNKNOWN = "cccc9999-9999-4000-8000-000000000099";

/** SECRET: passed in as input only. Never asserted present in any response. */
const TOKEN_VALUE = "fcm-device-token-abcdefghijklmnop";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abcdef123456";

function token(roles: string[], tid = TENANT, sub = ACTOR): string {
  return signToken({ sub, tid, roles, sid: "sess-push" }, SECRET, 3600);
}
const bearer = (roles: string[], tid = TENANT, sub = ACTOR) =>
  ({ authorization: `Bearer ${token(roles, tid, sub)}` });

/** Message ids this file has delivered, so cleanup can scope its reset. */
const deliveredMessageIds = new Set<string>();

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.tenantId, TENANT));
    await tx.delete(inAppMessages).where(eq(inAppMessages.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
  // _inbox.processed is a SHARED, non-tenant-scoped table. An unqualified
  // DELETE here would wipe the idempotency markers of every OTHER test file
  // running in parallel, which silently breaks their "second delivery is a
  // no-op" assertions. Only this file's own message ids are removed.
  if (deliveredMessageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...deliveredMessageIds]));
    deliveredMessageIds.clear();
  }
}

async function seedSubscription(id = SUB_ID, userId = ACTOR): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(pushSubscriptions).values({
      id, tenantId: TENANT, userId, platform: "android",
      deviceToken: TOKEN_VALUE, tokenHash: blindIndex(TOKEN_VALUE),
      enabled: true, createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    }).onConflictDoNothing();
  }));
}

async function seedMessage(id = MSG_ID, userId = ACTOR, read = false): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(inAppMessages).values({
      id, tenantId: TENANT, userId, title: "Budget approved",
      body: "Your budget request has been approved.", severity: "info",
      readAt: read ? new Date() : null,
      createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    }).onConflictDoNothing();
  }));
}

async function deliver(topic: string, messageId: string, payload: unknown): Promise<MemoryQueue> {
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerPushConsumers(q);
  await q.start();
  await q.publish(topic, {
    messageId, type: topic, tenantId: TENANT, actorId: ACTOR,
    correlationId: `corr-${messageId}`, schemaVersion: "1.0", payload,
  });
  await q.drain();
  await q.stop();
  return q;
}

beforeAll(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("POST /v1/notification/push/subscriptions", () => {
  it("202 for a user registering their own Android device", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/subscriptions", headers: bearer(["employee"]),
      payload: { platform: "android", deviceToken: TOKEN_VALUE },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    // The token is a bearer credential — it must not be echoed.
    expect(res.body).not.toContain(TOKEN_VALUE);
  });

  it("202 for a web device with an https endpoint", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/subscriptions", headers: bearer(["employee"]),
      payload: { platform: "web", deviceToken: TOKEN_VALUE, endpoint: ENDPOINT, userAgent: "Firefox/128" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("202 for an admin registering on behalf of another user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/subscriptions", headers: bearer(["notification_admin"]),
      payload: { userId: OTHER_USER, platform: "ios", deviceToken: TOKEN_VALUE },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("403 when a normal user tries to register a device for someone else", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/subscriptions", headers: bearer(["employee"]),
      payload: { userId: OTHER_USER, platform: "ios", deviceToken: TOKEN_VALUE },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("422 for a web subscription with no endpoint", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/subscriptions", headers: bearer(["employee"]),
      payload: { platform: "web", deviceToken: TOKEN_VALUE },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_ENDPOINT");
  });

  it("400 for an http endpoint — zod rejects it before the business rule", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/subscriptions", headers: bearer(["employee"]),
      payload: { platform: "web", deviceToken: TOKEN_VALUE, endpoint: "not a url" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("422 for a plaintext http endpoint that is still a valid URL", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/subscriptions", headers: bearer(["employee"]),
      payload: { platform: "web", deviceToken: TOKEN_VALUE, endpoint: "http://fcm.googleapis.com/x" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("400 for an unsupported platform", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/subscriptions", headers: bearer(["employee"]),
      payload: { platform: "blackberry", deviceToken: TOKEN_VALUE },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a device token below the minimum length", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/subscriptions", headers: bearer(["employee"]),
      payload: { platform: "android", deviceToken: "short" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a missing device token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/subscriptions", headers: bearer(["employee"]),
      payload: { platform: "android" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/subscriptions",
      payload: { platform: "android", deviceToken: TOKEN_VALUE },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside the self-service set", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/subscriptions", headers: bearer(["auditor_external"]),
      payload: { platform: "android", deviceToken: TOKEN_VALUE },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/notification/push/subscriptions", () => {
  beforeAll(() => seedSubscription());

  it("200 returning only a masked token preview", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/push/subscriptions?limit=20", headers: bearer(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const row = (res.json().data as Array<{ tokenPreview: string; id: string }>)
      .find((r) => r.id === SUB_ID);
    expect(row?.tokenPreview).toBe("****mnop");
    expect(res.body).not.toContain(TOKEN_VALUE);
    expect(res.json().meta).toMatchObject({ page: 1, pageSize: 20 });
  });

  it("403 when a normal user asks for another user's subscriptions", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/push/subscriptions?limit=20&userId=${OTHER_USER}`,
      headers: bearer(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("200 when an admin asks for another user's subscriptions", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/push/subscriptions?limit=20&userId=${OTHER_USER}`,
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("400 when limit is omitted", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/push/subscriptions", headers: bearer(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-uuid userId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/push/subscriptions?limit=10&userId=nope",
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/notification/push/subscriptions?limit=10" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside the self-service set", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/push/subscriptions?limit=10",
      headers: bearer(["auditor_external"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/notification/push/subscriptions/:id", () => {
  it("202 for a user revoking a subscription", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: `/v1/notification/push/subscriptions/${SUB_ID}`, headers: bearer(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("400 for a non-uuid id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: "/v1/notification/push/subscriptions/nope", headers: bearer(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: `/v1/notification/push/subscriptions/${SUB_ID}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside the self-service set", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: `/v1/notification/push/subscriptions/${SUB_ID}`,
      headers: bearer(["auditor_external"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/notification/push/send", () => {
  beforeEach(async () => { await cleanup(); await seedSubscription(SUB_ID, OTHER_USER); });

  it("202 when the user has an active subscription", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/send", headers: bearer(["notification_admin"]),
      payload: { userId: OTHER_USER, body: "Your file has moved to the next desk." },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("422 when the user has no active subscription", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/send", headers: bearer(["notification_admin"]),
      payload: { userId: UNKNOWN, body: "nobody is listening" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("NO_ACTIVE_SUBSCRIPTION");
  });

  it("400 for a missing body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/send", headers: bearer(["notification_admin"]),
      payload: { userId: OTHER_USER },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-uuid userId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/send", headers: bearer(["notification_admin"]),
      payload: { userId: "nope", body: "x" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/send", payload: { userId: OTHER_USER, body: "x" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a non-admin — sending to another user is an admin action", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/push/send", headers: bearer(["employee"]),
      payload: { userId: OTHER_USER, body: "x" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/notification/in-app/messages", () => {
  it("202 for an admin creating a message", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/in-app/messages", headers: bearer(["notification_admin"]),
      payload: { userId: OTHER_USER, title: "Action needed", body: "Approve the pending bill.", severity: "action_required" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("400 for an unknown severity", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/in-app/messages", headers: bearer(["notification_admin"]),
      payload: { userId: OTHER_USER, title: "t", body: "b", severity: "catastrophic" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a missing title", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/in-app/messages", headers: bearer(["notification_admin"]),
      payload: { userId: OTHER_USER, body: "b" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-URL actionUrl", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/in-app/messages", headers: bearer(["notification_admin"]),
      payload: { userId: OTHER_USER, title: "t", body: "b", actionUrl: "nope" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/in-app/messages",
      payload: { userId: OTHER_USER, title: "t", body: "b" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a non-admin — a user cannot place messages in another inbox", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/in-app/messages", headers: bearer(["employee"]),
      payload: { userId: OTHER_USER, title: "t", body: "b" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/notification/in-app/messages", () => {
  beforeAll(async () => { await seedMessage(MSG_ID, ACTOR, false); });

  it("200 with the inbox and an unread count in meta", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/in-app/messages?limit=20", headers: bearer(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.unread).toBeGreaterThanOrEqual(1);
    expect(body.data.find((m: { id: string }) => m.id === MSG_ID)?.read).toBe(false);
  });

  it("200 with unreadOnly=true", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/in-app/messages?limit=20&unreadOnly=true",
      headers: bearer(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect((res.json().data as Array<{ read: boolean }>).every((m) => !m.read)).toBe(true);
  });

  it("400 for a non-boolean unreadOnly", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/in-app/messages?limit=20&unreadOnly=perhaps",
      headers: bearer(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("403 when a normal user reads another user's inbox", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/in-app/messages?limit=20&userId=${OTHER_USER}`,
      headers: bearer(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("200 when an admin reads another user's inbox", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/in-app/messages?limit=20&userId=${OTHER_USER}`,
      headers: bearer(["tenant_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("400 when limit is omitted", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/in-app/messages", headers: bearer(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/notification/in-app/messages?limit=10" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside the self-service set", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/in-app/messages?limit=10", headers: bearer(["auditor_external"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/notification/in-app/messages/:id/read", () => {
  beforeEach(async () => { await cleanup(); await seedMessage(MSG_ID, ACTOR, false); });

  it("202 for the message owner", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/in-app/messages/${MSG_ID}/read`, headers: bearer(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("404 for a message that belongs to another user", async () => {
    await seedMessage("cccc3333-1111-4000-8000-000000000033", OTHER_USER, false);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/in-app/messages/cccc3333-1111-4000-8000-000000000033/read",
      headers: bearer(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("404 for an unknown message", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/in-app/messages/${UNKNOWN}/read`, headers: bearer(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("400 for a non-uuid id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/in-app/messages/nope/read", headers: bearer(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/notification/in-app/messages/${MSG_ID}/read` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside the self-service set", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/in-app/messages/${MSG_ID}/read`,
      headers: bearer(["auditor_external"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("push consumer", () => {
  beforeEach(cleanup);

  async function rows() {
    return runWithTenant(TENANT, () => db.transaction(async (tx) => ({
      subs: await tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.tenantId, TENANT)),
      msgs: await tx.select().from(inAppMessages).where(eq(inAppMessages.tenantId, TENANT)),
      outbox: await tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)),
    })));
  }

  it("registers a subscription with the token encrypted and hashed", async () => {
    await deliver(COMMANDS.registerPushSubscription, "cccc4444-1111-4000-8000-000000000401", {
      id: SUB_ID, tenantId: TENANT, userId: ACTOR, platform: "android", deviceToken: TOKEN_VALUE,
    });
    const { subs, outbox } = await rows();
    expect(subs).toHaveLength(1);
    expect(subs[0]?.deviceToken).toBe(TOKEN_VALUE);
    expect(subs[0]?.tokenHash).toBe(blindIndex(TOKEN_VALUE));
    expect(subs[0]?.enabled).toBe(true);
    const registered = outbox.find((m) => m.eventType === EVENTS.pushSubscriptionRegistered);
    // The token is a bearer credential and must never travel in an event payload.
    expect(JSON.stringify(registered?.payload)).not.toContain(TOKEN_VALUE);
  });

  it("stores the token as ciphertext at rest, not cleartext", async () => {
    await deliver(COMMANDS.registerPushSubscription, "cccc4444-1111-4000-8000-000000000402", {
      id: SUB_ID, tenantId: TENANT, userId: ACTOR, platform: "android", deviceToken: TOKEN_VALUE,
    });
    // Read the raw column, bypassing the encryptedText() decrypt on the way out.
    // Parameterised, not interpolated — the same rule applies in tests.
    const raw = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.execute(sql`SELECT device_token FROM push.push_subscriptions WHERE id = ${SUB_ID}`)));
    const stored = (raw as unknown as Array<{ device_token: string }>)[0]?.device_token ?? "";
    expect(stored).not.toContain(TOKEN_VALUE);
    expect(stored.startsWith("enc:v2:")).toBe(true);
  });

  it("processing the same registration twice writes one row (idempotency)", async () => {
    const MSG = "cccc4444-1111-4000-8000-000000000403";
    const payload = {
      id: SUB_ID, tenantId: TENANT, userId: ACTOR, platform: "android", deviceToken: TOKEN_VALUE,
    };
    await deliver(COMMANDS.registerPushSubscription, MSG, payload);
    const first = await rows();
    await deliver(COMMANDS.registerPushSubscription, MSG, payload);
    const second = await rows();
    expect(first.subs).toHaveLength(1);
    expect(second.subs).toHaveLength(1);
    expect(second.outbox).toHaveLength(first.outbox.length);
  });

  it("re-registering the same device under a new id updates rather than duplicating", async () => {
    await deliver(COMMANDS.registerPushSubscription, "cccc4444-1111-4000-8000-000000000404", {
      id: SUB_ID, tenantId: TENANT, userId: ACTOR, platform: "android", deviceToken: TOKEN_VALUE,
    });
    await deliver(COMMANDS.registerPushSubscription, "cccc4444-1111-4000-8000-000000000405", {
      id: "cccc5555-1111-4000-8000-000000000055", tenantId: TENANT, userId: ACTOR,
      platform: "ios", deviceToken: TOKEN_VALUE,
    });
    const { subs } = await rows();
    expect(subs).toHaveLength(1);
    expect(subs[0]?.platform).toBe("ios");
  });

  it("dead-letters a blank device token", async () => {
    const q = await deliver(COMMANDS.registerPushSubscription, "cccc4444-1111-4000-8000-000000000406", {
      id: SUB_ID, tenantId: TENANT, userId: ACTOR, platform: "android", deviceToken: "  ",
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("deviceToken is required");
    expect((await rows()).subs).toHaveLength(0);
  });

  it("dead-letters an unsupported platform", async () => {
    const q = await deliver(COMMANDS.registerPushSubscription, "cccc4444-1111-4000-8000-000000000407", {
      id: SUB_ID, tenantId: TENANT, userId: ACTOR, platform: "symbian", deviceToken: TOKEN_VALUE,
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("unsupported platform");
  });

  it("dead-letters a web subscription with no endpoint", async () => {
    const q = await deliver(COMMANDS.registerPushSubscription, "cccc4444-1111-4000-8000-000000000408", {
      id: SUB_ID, tenantId: TENANT, userId: ACTOR, platform: "web", deviceToken: TOKEN_VALUE,
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("https endpoint");
  });

  it("dead-letters a web subscription with an http endpoint", async () => {
    const q = await deliver(COMMANDS.registerPushSubscription, "cccc4444-1111-4000-8000-000000000409", {
      id: SUB_ID, tenantId: TENANT, userId: ACTOR, platform: "web",
      deviceToken: TOKEN_VALUE, endpoint: "http://fcm.googleapis.com/x",
    });
    expect(q.dlq).toHaveLength(1);
  });

  it("revokes a subscription and keeps the row for audit", async () => {
    await seedSubscription();
    await deliver(COMMANDS.revokePushSubscription, "cccc4444-1111-4000-8000-000000000410", {
      id: SUB_ID, tenantId: TENANT,
    });
    const { subs, outbox } = await rows();
    expect(subs).toHaveLength(1);
    expect(subs[0]?.enabled).toBe(false);
    expect(subs[0]?.revokedAt).not.toBeNull();
    expect(subs[0]?.version).toBe(2);
    expect(outbox.map((m) => m.eventType)).toContain(EVENTS.pushSubscriptionRevoked);
  });

  it("revoking twice with the same messageId does not bump the version twice", async () => {
    await seedSubscription();
    const MSG = "cccc4444-1111-4000-8000-000000000411";
    await deliver(COMMANDS.revokePushSubscription, MSG, { id: SUB_ID, tenantId: TENANT });
    const first = await rows();
    const q = await deliver(COMMANDS.revokePushSubscription, MSG, { id: SUB_ID, tenantId: TENANT });
    const second = await rows();
    expect(second.subs[0]?.version).toBe(first.subs[0]?.version);
    expect(q.dlq).toHaveLength(0);
  });

  it("dead-letters a revoke for an unknown subscription", async () => {
    const q = await deliver(COMMANDS.revokePushSubscription, "cccc4444-1111-4000-8000-000000000412", {
      id: UNKNOWN, tenantId: TENANT,
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("SUBSCRIPTION_NOT_FOUND");
  });

  it("creates an in-app message with the default severity", async () => {
    await deliver(COMMANDS.createInAppMessage, "cccc4444-1111-4000-8000-000000000413", {
      id: MSG_ID, tenantId: TENANT, userId: ACTOR, title: "Budget approved", body: "Details inside.",
    });
    const { msgs, outbox } = await rows();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.severity).toBe("info");
    expect(msgs[0]?.readAt).toBeNull();
    expect(outbox.map((m) => m.eventType)).toContain(EVENTS.inAppMessageCreated);
  });

  it("creating the same in-app message twice writes one row (idempotency)", async () => {
    const MSG = "cccc4444-1111-4000-8000-000000000414";
    const payload = { id: MSG_ID, tenantId: TENANT, userId: ACTOR, title: "t", body: "b" };
    await deliver(COMMANDS.createInAppMessage, MSG, payload);
    await deliver(COMMANDS.createInAppMessage, MSG, payload);
    expect((await rows()).msgs).toHaveLength(1);
  });

  it("marks a message read and emits the read event", async () => {
    await seedMessage();
    await deliver(COMMANDS.markInAppRead, "cccc4444-1111-4000-8000-000000000415", {
      id: MSG_ID, tenantId: TENANT, userId: ACTOR,
    });
    const { msgs, outbox } = await rows();
    expect(msgs[0]?.readAt).not.toBeNull();
    expect(msgs[0]?.version).toBe(2);
    expect(outbox.map((m) => m.eventType)).toContain(EVENTS.inAppMessageRead);
  });

  it("re-reading an already-read message is a no-op, not an error", async () => {
    await seedMessage(MSG_ID, ACTOR, true);
    const q = await deliver(COMMANDS.markInAppRead, "cccc4444-1111-4000-8000-000000000416", {
      id: MSG_ID, tenantId: TENANT, userId: ACTOR,
    });
    const { msgs } = await rows();
    expect(q.dlq).toHaveLength(0);
    expect(msgs[0]?.version).toBe(1);
  });

  it("dead-letters a read for an unknown message", async () => {
    const q = await deliver(COMMANDS.markInAppRead, "cccc4444-1111-4000-8000-000000000417", {
      id: UNKNOWN, tenantId: TENANT, userId: ACTOR,
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("IN_APP_MESSAGE_NOT_FOUND");
  });

  it("dead-letters a read from a user who does not own the message", async () => {
    await seedMessage(MSG_ID, OTHER_USER, false);
    const q = await deliver(COMMANDS.markInAppRead, "cccc4444-1111-4000-8000-000000000418", {
      id: MSG_ID, tenantId: TENANT, userId: ACTOR,
    });
    expect(q.dlq).toHaveLength(1);
  });
});
