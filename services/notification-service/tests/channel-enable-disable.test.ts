/**
 * GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-01 (real DB, real Fastify): the
 * enable/disable control. PATCH /notifications/channels/:id publishes a CQRS
 * command; the consumer flips `enabled` and writes the audit row in ONE
 * transaction. Role gate, tenant isolation, mandatory reason on disable, and
 * replay (same messageId) idempotence are pinned.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
import { COMMANDS } from "../src/topics.js";

const { buildApp } = await import("../src/app.js");

const SECRET = process.env.JWT_SECRET as string;
const A = randomUUID();
const B = randomUUID();
const ACTOR = randomUUID();
const CH = randomUUID();
const bearer = (roles: string[], tid: string) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, roles, tid } as never, SECRET)}`,
});
const drain = () => (queue as unknown as { drain(): Promise<void> }).drain();

async function channel() {
  const rows = await runWithTenant(A, () => db.transaction((tx) =>
    tx.select().from(notificationChannels).where(eq(notificationChannels.id, CH))));
  return rows[0]!;
}
async function auditRows() {
  const rows = await runWithTenant(A, () => db.transaction((tx) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, A))));
  return rows.filter((r) => ["enable_channel", "disable_channel"].includes((r.payload as { action?: string }).action ?? ""));
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
  registerChannelConsumers(queue);
  await queue.start();
  app = await buildApp();
  await cleanup();
  await runWithTenant(A, () => db.transaction((tx) => tx.insert(notificationChannels).values({
    id: CH, tenantId: A, type: "email", name: "Office email", isDefault: true, enabled: true, createdBy: ACTOR, updatedBy: ACTOR,
  })));
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("PATCH /notifications/channels/:id (enable / disable)", () => {
  it("disable without a reason is a 400 and changes nothing", async () => {
    const r = await app.inject({ method: "PATCH", url: `/notifications/channels/${CH}`, headers: bearer(["tenant_admin"], A), payload: { enabled: false } });
    expect(r.statusCode).toBe(400);
    await drain();
    expect((await channel()).enabled).toBe(true);
  });

  it("a non-admin role is refused (403)", async () => {
    const r = await app.inject({ method: "PATCH", url: `/notifications/channels/${CH}`, headers: bearer(["employee"], A), payload: { enabled: false, reason: "no access" } });
    expect(r.statusCode).toBe(403);
  });

  it("another tenant gets 404 for this channel and cannot change it", async () => {
    const r = await app.inject({ method: "PATCH", url: `/notifications/channels/${CH}`, headers: bearer(["tenant_admin"], B), payload: { enabled: false, reason: "cross tenant attempt" } });
    expect(r.statusCode).toBe(404);
    await drain();
    expect((await channel()).enabled).toBe(true);
  });

  it("tenant_admin disables with a reason: row flips, version bumps, one audit row carries before/after/reason", async () => {
    const before = await channel();
    const r = await app.inject({ method: "PATCH", url: `/notifications/channels/${CH}`, headers: bearer(["tenant_admin"], A), payload: { enabled: false, reason: "provider outage" } });
    expect(r.statusCode).toBe(202);
    await drain();
    const after = await channel();
    expect(after.enabled).toBe(false);
    expect(after.version).toBe(before.version + 1);
    expect(after.updatedBy).toBe(ACTOR);
    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    const p = audit[0]!.payload as { action: string; before: { enabled: boolean }; after: { enabled: boolean }; reason: string };
    expect(p.action).toBe("disable_channel");
    expect(p.before.enabled).toBe(true);
    expect(p.after.enabled).toBe(false);
    expect(p.reason).toBe("provider outage");
  });

  it("re-enable needs no reason and is audited", async () => {
    const r = await app.inject({ method: "PATCH", url: `/notifications/channels/${CH}`, headers: bearer(["tenant_admin"], A), payload: { enabled: true } });
    expect(r.statusCode).toBe(202);
    await drain();
    expect((await channel()).enabled).toBe(true);
    expect((await auditRows()).map((a) => (a.payload as { action: string }).action).sort()).toEqual(["disable_channel", "enable_channel"]);
  });

  it("replaying the same command messageId is a no-op (markProcessed)", async () => {
    const messageId = randomUUID();
    seen.push(messageId);
    const msg = {
      messageId, type: COMMANDS.setChannelEnabled, tenantId: A, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: CH, tenantId: A, enabled: false, reason: "replay test" },
    };
    await queue.publish(COMMANDS.setChannelEnabled, msg);
    await drain();
    const v1 = (await channel()).version;
    const n1 = (await auditRows()).length;
    await queue.publish(COMMANDS.setChannelEnabled, msg);
    await drain();
    expect((await channel()).version).toBe(v1);
    expect((await auditRows()).length).toBe(n1);
  });
});
