/**
 * GAP-TENANT-ADMIN-SESSIONS-06: the tenant-admin UI's revoke button calls
 * DELETE /identity/sessions/:id through the proxy. This DB-backed route test
 * pins the server-side guarantees the UI relies on:
 *   1. A session that belongs to tenant B cannot be revoked by a tenant A
 *      admin — the route returns 404 (not a silent cross-tenant kill) and the
 *      session row stays "active".
 *   2. An own-tenant revoke is accepted (202) and the consumer flips the row to
 *      "revoked" AND writes a session audit event to the outbox.
 *
 * Drives the REAL app (buildApp) + REAL consumer against Postgres; mirrors the
 * tenant-aware queue wiring worker.ts uses so RLS GUC is set.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { MemoryQueue, type Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";

const RUN_DB = process.env.DATABASE_URL ?? process.env.DB_URL;
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TENANT_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ADMIN_A = "a0000000-0000-4000-8000-0000000000a1";

function adminToken(tid: string): string {
  return signToken(
    { sub: ADMIN_A, tid, roles: ["tenant_admin"], sid: "5e551014-0000-4000-8000-00000000005e" } as never,
    SECRET,
  );
}

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

// FLAKY-SKIP: Requires DATABASE_URL/DB_URL against a real Postgres for the cross-tenant session-revoke isolation + audit check; unset in standard CI so this suite never executes there. (expires: 2026-12-13)
describe.skipIf(!RUN_DB)("DELETE /identity/sessions/:id — cross-tenant isolation + audit (GAP-TENANT-ADMIN-SESSIONS-06)", () => {
  let app: FastifyInstance;
  let repo: typeof import("../src/modules/sessions/repo.js");
  let db: any;
  let sessions: any;
  let outboxMessages: any;
  let registerSessionConsumers: typeof import("../src/modules/sessions/consumer.js")["registerSessionConsumers"];
  let COMMANDS: typeof import("../src/topics.js")["COMMANDS"];
  let q: Queue;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    repo = await import("../src/modules/sessions/repo.js");
    ({ db } = await import("../src/shared/db.js"));
    ({ sessions } = await import("../src/modules/sessions/schema.js"));
    ({ outboxMessages } = await import("../src/shared/outbox.js"));
    ({ registerSessionConsumers } = await import("../src/modules/sessions/consumer.js"));
    ({ COMMANDS } = await import("../src/topics.js"));
    q = wireTenantAwareQueue(new MemoryQueue());
    registerSessionConsumers(q);
    await q.start();
  });

  afterAll(async () => {
    for (const t of [TENANT_A, TENANT_B]) {
      await runWithTenant(t, () => db.transaction(async (tx: any) => {
        await tx.delete(sessions).where(eq(sessions.tenantId, t));
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      }));
    }
    await app.close();
  });

  async function seed(tenantId: string, userId: string): Promise<string> {
    const id = randomUUID();
    await runWithTenant(tenantId, () => db.transaction(async (tx: any) => {
      await repo.insert(tx, {
        id, tenantId, userId, ip: "10.0.0.9", device: "seed", mfaMethod: null,
        trusted: false, status: "active", expiresAt: new Date(Date.now() + 3600_000),
        createdBy: userId, updatedBy: userId, version: 1,
      });
    }));
    return id;
  }

  it("tenant A admin gets 404 for a tenant B session, and that session stays active", async () => {
    const bSession = await seed(TENANT_B, randomUUID());

    const res = await app.inject({
      method: "DELETE",
      url: `/identity/sessions/${bSession}`,
      headers: { authorization: `Bearer ${adminToken(TENANT_A)}` },
    });
    expect(res.statusCode).toBe(404);

    const [row] = await runWithTenant(TENANT_B, () => db.transaction((tx: any) =>
      tx.select().from(sessions).where(and(eq(sessions.tenantId, TENANT_B), eq(sessions.id, bSession)))));
    expect(row?.status).toBe("active");
  });

  it("own-tenant revoke is accepted (202) and the consumer revokes + audits it", async () => {
    const aSession = await seed(TENANT_A, randomUUID());

    const res = await app.inject({
      method: "DELETE",
      url: `/identity/sessions/${aSession}`,
      headers: { authorization: `Bearer ${adminToken(TENANT_A)}` },
    });
    expect(res.statusCode).toBe(202);

    // Drive the enqueued revoke command through the real consumer.
    await q.publish(COMMANDS.revokeSession, {
      messageId: randomUUID(), type: COMMANDS.revokeSession, tenantId: TENANT_A, actorId: ADMIN_A,
      correlationId: randomUUID(), schemaVersion: "1.0", timestamp: new Date().toISOString(),
      payload: { id: aSession },
    } as never);

    await new Promise((r) => setTimeout(r, 500));

    const [row] = await runWithTenant(TENANT_A, () => db.transaction((tx: any) =>
      tx.select().from(sessions).where(and(eq(sessions.tenantId, TENANT_A), eq(sessions.id, aSession)))));
    expect(row?.status).toBe("revoked");

    const audits = await runWithTenant(TENANT_A, () => db.transaction((tx: any) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_A))));
    const hasSessionAudit = audits.some((m: any) =>
      JSON.stringify(m).includes("session") && JSON.stringify(m).includes(aSession));
    expect(hasSessionAudit).toBe(true);
  });
});
