/**
 * SEC-006 fixup — coverage gap the review flagged: identity-service's actual
 * revoke wiring (`modules/sessions/consumer.ts`, both `COMMANDS.revokeSession`
 * and `COMMANDS.revokeAllSessions`) had ZERO automated coverage of the
 * `denylistSession()` calls added for SEC-006. Neither
 * `session-reaper.db.test.ts` nor `sessions-apikeys-routes.test.ts` (nor any
 * other test in this service) references `denylist` / `revokeSession` /
 * `revokeAllSessions` at all — a future refactor could silently drop one or
 * both `denylistSession()` call sites and nothing would catch it, which is
 * exactly the regression class SEC-006 exists to prevent.
 *
 * This test exercises the REAL consumer (`registerSessionConsumers`) against
 * a real, isolated Postgres — not a reimplementation of the handler logic —
 * and asserts against `isSessionDenylisted()` (the same read-side function
 * `authPlugin` calls) that the write actually landed, not just that the
 * `sessions` row's status flipped.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { isSessionDenylisted, __setDenylistStoreForTests } from "@civitasone/auth/denylist";
import { MemoryCache } from "@civitasone/cache";

const RUN_DB = process.env.DATABASE_URL ?? process.env.DB_URL;

const TENANT = "d5555555-5555-4000-8000-000000000d5d";
const ACTOR = "a0000000-0000-4000-8000-00000000aa02";

function envelope(type: string, messageId: string, payload: Record<string, unknown>) {
  return {
    messageId, type, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0",
    timestamp: new Date().toISOString(), payload,
  };
}

// Mirrors worker.ts EXACTLY (src/worker.ts, just above registerSessionConsumers):
// consumers call db.transaction() and RLS requires app.tenant_id GUC to be
// set, which worker.ts achieves by wrapping queue.subscribe() to run every
// handler inside runWithTenant(msg.tenantId, ...). Without this wrapping here
// too, the real consumer would hit the exact same RLS-fails-closed class of
// bug session-reaper.db.test.ts documents elsewhere in this service — so this
// test wires the queue the same way production actually does, not a
// simplified stand-in.
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

describe.skipIf(!RUN_DB)("sessions consumer — SEC-006 denylist wiring (real consumer, real Postgres)", () => {
  let repo: typeof import("../src/modules/sessions/repo.js");
  let db: any;
  let sessions: any;
  let outboxMessages: any;
  let processed: any;
  let registerSessionConsumers: typeof import("../src/modules/sessions/consumer.js")["registerSessionConsumers"];
  let COMMANDS: typeof import("../src/topics.js")["COMMANDS"];

  beforeAll(async () => {
    // A dedicated in-memory store for this file only, isolated from whatever
    // other test files in this same vitest run touch the denylist — real
    // production code path (denylistSession/isSessionDenylisted -> the shared
    // store), just not sharing a container-external Redis for this suite.
    __setDenylistStoreForTests(new MemoryCache());

    repo = await import("../src/modules/sessions/repo.js");
    ({ db } = await import("../src/shared/db.js"));
    ({ sessions } = await import("../src/modules/sessions/schema.js"));
    ({ outboxMessages, processed } = await import("../src/shared/outbox.js"));
    ({ registerSessionConsumers } = await import("../src/modules/sessions/consumer.js"));
    ({ COMMANDS } = await import("../src/topics.js"));
  });

  afterAll(async () => {
    await cleanup();
    __setDenylistStoreForTests(null);
  });

  async function cleanup() {
    await runWithTenant(TENANT, () => db.transaction(async (tx: any) => {
      await tx.delete(sessions).where(eq(sessions.tenantId, TENANT));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    }));
  }

  async function seedActiveSession(userId: string): Promise<string> {
    const id = randomUUID();
    await runWithTenant(TENANT, () => db.transaction(async (tx: any) => {
      await repo.insert(tx, {
        id, tenantId: TENANT, userId, ip: "127.0.0.1",
        device: "test-device", mfaMethod: null, trusted: false,
        status: "active", expiresAt: new Date(Date.now() + 3600_000),
        createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
    }));
    return id;
  }

  beforeAll(cleanup);

  it("COMMANDS.revokeSession: the real consumer denylists the session's sid, not just flips the DB row", async () => {
    const userId = randomUUID();
    const sid = await seedActiveSession(userId);

    expect(await isSessionDenylisted(sid)).toBe(false); // sanity: not denylisted before revoke

    const q: Queue = new MemoryQueue();
    registerSessionConsumers(wireTenantAwareQueue(q));
    await q.start();
    await q.publish(COMMANDS.revokeSession, envelope(COMMANDS.revokeSession, randomUUID(), { id: sid }));
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    // The DB row flipped (pre-existing behaviour)... findById reads inside a
    // transaction too (RLS-enforced), so it needs the same ambient tenant
    // context as the writes above.
    const row = await runWithTenant(TENANT, () => repo.findById(TENANT, sid));
    expect(row?.status).toBe("revoked");

    // ...AND the denylist write actually landed — the assertion this file
    // exists to add. Reads through the SAME function authPlugin's onRequest
    // hook calls (isSessionDenylisted), not a reimplementation.
    expect(await isSessionDenylisted(sid)).toBe(true);
  });

  it("COMMANDS.revokeAllSessions: the real consumer denylists every revoked session's sid", async () => {
    const userId = randomUUID();
    const sidA = await seedActiveSession(userId);
    const sidB = await seedActiveSession(userId);

    expect(await isSessionDenylisted(sidA)).toBe(false);
    expect(await isSessionDenylisted(sidB)).toBe(false);

    const q: Queue = new MemoryQueue();
    registerSessionConsumers(wireTenantAwareQueue(q));
    await q.start();
    await q.publish(COMMANDS.revokeAllSessions, envelope(COMMANDS.revokeAllSessions, randomUUID(), { userId }));
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction((tx: any) =>
      tx.select().from(sessions).where(and(eq(sessions.tenantId, TENANT), eq(sessions.userId, userId)))));
    expect(rows.every((r: any) => r.status === "revoked")).toBe(true);

    expect(await isSessionDenylisted(sidA)).toBe(true);
    expect(await isSessionDenylisted(sidB)).toBe(true);
  });

  it("does not denylist an unrelated session that was never revoked", async () => {
    const userId = randomUUID();
    const revokedSid = await seedActiveSession(userId);
    const untouchedSid = await seedActiveSession(randomUUID()); // different user, never targeted

    const q: Queue = new MemoryQueue();
    registerSessionConsumers(wireTenantAwareQueue(q));
    await q.start();
    await q.publish(COMMANDS.revokeSession, envelope(COMMANDS.revokeSession, randomUUID(), { id: revokedSid }));
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    expect(await isSessionDenylisted(revokedSid)).toBe(true);
    expect(await isSessionDenylisted(untouchedSid)).toBe(false);
  });
});
