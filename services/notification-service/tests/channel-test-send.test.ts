/**
 * GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-01 / owner decision #25 (real DB, real Fastify):
 * "use platform-provisioned channels; credentials only in the secrets manager;
 * test-send goes to the admin's own address/number."
 *
 * POST /notifications/channels/:id/test-send publishes a CQRS command (202). The
 * consumer resolves the CALLER's own address from identity-service (the request
 * can never name a recipient), sends one test message through the platform
 * adapter, and writes the audit row (masked recipient, outcome) in the SAME
 * transaction as markProcessed.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { processed, outboxMessages } from "../src/shared/outbox.js";
import { notificationChannels } from "../src/modules/channels/schema.js";
import { registerChannelConsumers } from "../src/modules/channels/consumer.js";
import { queue } from "../src/shared/infra.js";
import { setEmailTransportForTests, MemoryEmailTransport } from "../src/adapters/index.js";

const { buildApp } = await import("../src/app.js");

const SECRET = process.env.JWT_SECRET as string;
const A = randomUUID();
const B = randomUUID();
const ADMIN = randomUUID();
const CH_EMAIL = randomUUID();
const CH_OFF = randomUUID();
const CH_SMS = randomUUID();
const ADMIN_EMAIL = "admin.officer@example.gov.in";
const bearer = (roles: string[], tid: string) => ({
  authorization: `Bearer ${signToken({ sub: ADMIN, roles, tid } as never, SECRET)}`,
});
const drain = () => (queue as unknown as { drain(): Promise<void> }).drain();
const transport = new MemoryEmailTransport();
const realFetch = globalThis.fetch;
let identityHits = 0;

async function audits() {
  const rows = await runWithTenant(A, () => db.transaction((tx) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, A))));
  return rows.filter((r) => (r.payload as { action?: string }).action === "test_send_channel");
}
const seen: string[] = [];
async function cleanup() {
  for (const t of [A, B]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(notificationChannels).where(eq(notificationChannels.tenantId, t));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    }));
  }
  if (seen.length) await db.delete(processed).where(inArray(processed.messageId, seen));
}

let app: FastifyInstance;
beforeAll(async () => {
  setEmailTransportForTests(transport);
  process.env.NOTIFICATION_EMAIL_DRIVER = "smtp";
  process.env.SMTP_FROM = "noreply@platform.example";
  process.env.SMTP_HOST = "smtp.platform.example";
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = String(input);
    if (url.includes(`/identity/internal/users/${ADMIN}/email`)) {
      identityHits++;
      return new Response(JSON.stringify({ id: ADMIN, email: ADMIN_EMAIL }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input as never, init as never);
  }) as typeof fetch;
  registerChannelConsumers(queue);
  await queue.start();
  app = await buildApp();
  await cleanup();
  await runWithTenant(A, () => db.transaction((tx) => tx.insert(notificationChannels).values([
    { id: CH_EMAIL, tenantId: A, type: "email", name: "Office email", isDefault: true, enabled: true, createdBy: ADMIN, updatedBy: ADMIN },
    { id: CH_OFF, tenantId: A, type: "email", name: "Old email", isDefault: false, enabled: false, createdBy: ADMIN, updatedBy: ADMIN },
    { id: CH_SMS, tenantId: A, type: "sms", name: "SMS gateway", isDefault: false, enabled: true, createdBy: ADMIN, updatedBy: ADMIN },
  ])));
});
afterEach(() => { transport.sent.length = 0; });
afterAll(async () => {
  globalThis.fetch = realFetch;
  setEmailTransportForTests(null);
  await cleanup(); await app.close(); await sqlClient.end();
});

describe("POST /notifications/channels/:id/test-send", () => {
  it("sends ONE test message to the calling admin's own address and audits it with a masked recipient", async () => {
    const r = await app.inject({ method: "POST", url: `/notifications/channels/${CH_EMAIL}/test-send`, headers: bearer(["tenant_admin"], A), payload: {} });
    expect(r.statusCode).toBe(202);
    await drain();
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.to).toBe(ADMIN_EMAIL);
    expect(identityHits).toBeGreaterThan(0);
    const rows = await audits();
    expect(rows).toHaveLength(1);
    const p = rows[0]!.payload as Record<string, unknown>;
    expect(p).toMatchObject({ service: "notification", resourceType: "channel", resourceId: CH_EMAIL, outcome: "success" });
    expect(JSON.stringify(p)).not.toContain(ADMIN_EMAIL); // PII masked in the audit row
    expect(String(p.recipient)).toMatch(/\*\*\*/);
  });

  it("a caller-supplied recipient is rejected (400) - the test can only go to the admin themself", async () => {
    const r = await app.inject({ method: "POST", url: `/notifications/channels/${CH_EMAIL}/test-send`, headers: bearer(["tenant_admin"], A), payload: { recipient: "victim@example.com" } });
    expect(r.statusCode).toBe(400);
    await drain();
    expect(transport.sent).toHaveLength(0);
  });

  it("a non-admin role is refused (403) and nothing is sent", async () => {
    const r = await app.inject({ method: "POST", url: `/notifications/channels/${CH_EMAIL}/test-send`, headers: bearer(["employee"], A), payload: {} });
    expect(r.statusCode).toBe(403);
    await drain();
    expect(transport.sent).toHaveLength(0);
  });

  it("another tenant gets 404 and nothing is sent", async () => {
    const r = await app.inject({ method: "POST", url: `/notifications/channels/${CH_EMAIL}/test-send`, headers: bearer(["tenant_admin"], B), payload: {} });
    expect(r.statusCode).toBe(404);
    await drain();
    expect(transport.sent).toHaveLength(0);
  });

  it("a disabled channel cannot be tested (409 CHANNEL_DISABLED)", async () => {
    const r = await app.inject({ method: "POST", url: `/notifications/channels/${CH_OFF}/test-send`, headers: bearer(["tenant_admin"], A), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("CHANNEL_DISABLED");
  });

  it("an SMS channel has no admin number on file: refused honestly (422), nothing sent", async () => {
    const r = await app.inject({ method: "POST", url: `/notifications/channels/${CH_SMS}/test-send`, headers: bearer(["tenant_admin"], A), payload: {} });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("TEST_SEND_UNSUPPORTED");
    // F10 (UAT B4): the decline is a plain sentence for the admin, not a jargon string.
    const msg = String(r.json().message);
    expect(msg).toMatch(/mobile number/i);
    expect(msg).toMatch(/SMS/);
    expect(msg).not.toMatch(/422|unsupported|device is on file/i);
  });

  it("a redelivered command (same messageId) sends and audits only once", async () => {
    const before = (await audits()).length;
    const messageId = randomUUID();
    seen.push(messageId);
    const cmd = {
      messageId, type: "notification.channel.test_send", tenantId: A, actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: CH_EMAIL, tenantId: A },
    };
    await queue.publish(cmd.type, cmd as never);
    await queue.publish(cmd.type, cmd as never);
    await drain();
    expect(transport.sent).toHaveLength(1);
    expect((await audits()).length).toBe(before + 1);
  });
});
