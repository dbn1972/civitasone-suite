/**
 * P0 security endpoints: reset-password + revoke-all-sessions (identity-service).
 *
 * Two-pronged, mirroring the existing service test style:
 *  - Route inject tests assert the authz boundary (401 unauth, 403 wrong role,
 *    404 wrong-tenant, 202 happy-path) without depending on a running worker.
 *  - Consumer integration tests register the real consumers against a MemoryQueue,
 *    seed rows in the dev DB, publish the command, and assert the DB mutation +
 *    audit.event.record in the outbox (and idempotency).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { users } from "../src/modules/users/schema.js";
import { sessions } from "../src/modules/sessions/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerSessionConsumers } from "../src/modules/sessions/consumer.js";
import { registerUserConsumers } from "../src/modules/users/consumer.js";

const SECRET = process.env.JWT_SECRET as string;

const T1 = "a1111111-1111-4000-8000-000000000001";
const T2 = "a2222222-2222-4000-8000-000000000002";
const ACTOR = "a0000000-0000-4000-8000-0000000000aa";

const USER_REVOKE = "b1111111-1111-4000-8000-000000000010";
const USER_RESET = "b2222222-2222-4000-8000-000000000020";
const OTHER_USER = "b3333333-3333-4000-8000-000000000030";

const SESS_A = "c1111111-1111-4000-8000-000000000001";
const SESS_B = "c1111111-1111-4000-8000-000000000002";
const SESS_REVOKED = "c1111111-1111-4000-8000-000000000003";
const SESS_OTHER = "c1111111-1111-4000-8000-000000000004";

const MSG_REVOKE_1 = "d1111111-1111-4000-8000-000000000001";
const MSG_REVOKE_2 = "d1111111-1111-4000-8000-000000000002";
const MSG_RESET_1 = "d2222222-2222-4000-8000-000000000001";

function token(roles: string[], tid: string): string {
  return signToken({ sub: ACTOR, roles, tid } as never, SECRET);
}
const bearer = (roles: string[], tid: string) => ({ authorization: `Bearer ${token(roles, tid)}` });

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function seedUser(id: string, tenantId: string, email: string) {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(users).values({
      id, tenantId, email, name: "Test User", status: "active",
      createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing();
  }));
}

async function seedSession(id: string, userId: string, tenantId: string, status: string) {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(sessions).values({
      id, tenantId, userId, ip: "203.0.113.1", status,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing();
  }));
}

async function cleanup() {
  await runWithTenant(T1, () => db.transaction(async (tx) => {
    for (const id of [SESS_A, SESS_B, SESS_REVOKED, SESS_OTHER]) {
      await tx.delete(sessions).where(eq(sessions.id, id));
    }
    for (const id of [USER_REVOKE, USER_RESET, OTHER_USER]) {
      await tx.delete(users).where(eq(users.id, id));
    }
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T1));
    for (const id of [MSG_REVOKE_1, MSG_REVOKE_2, MSG_RESET_1]) {
      await tx.delete(processed).where(eq(processed.messageId, id));
    }
  }));
}

beforeAll(async () => {
  await cleanup();
  await seedUser(USER_REVOKE, T1, "revoke@test.gov.in");
  await seedUser(USER_RESET, T1, "reset@test.gov.in");
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("POST /identity/users/:id/sessions/revoke-all — route authz (inject)", () => {
  it("401 without token", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/identity/users/${USER_REVOKE}/sessions/revoke-all` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a non-admin role", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/identity/users/${USER_REVOKE}/sessions/revoke-all`, headers: bearer(["employee"], T1) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("404 for an admin from a different tenant (cross-tenant hidden)", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/identity/users/${USER_REVOKE}/sessions/revoke-all`, headers: bearer(["tenant_admin"], T2) });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("202 for a tenant_admin on a user in their tenant", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/identity/users/${USER_REVOKE}/sessions/revoke-all`, headers: bearer(["tenant_admin"], T1) });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

describe("POST /identity/users/:id/reset-password — route authz (inject)", () => {
  it("401 without token", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/identity/users/${USER_RESET}/reset-password` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a non-admin role", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/identity/users/${USER_RESET}/reset-password`, headers: bearer(["employee"], T1) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown user", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/identity/users/b9999999-9999-4000-8000-000000000099/reset-password`, headers: bearer(["tenant_admin"], T1) });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("202 for a tenant_admin on a user in their tenant", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/identity/users/${USER_RESET}/reset-password`, headers: bearer(["tenant_admin"], T1) });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

describe("revoke-all consumer — CQRS (integration)", () => {
  beforeAll(async () => {
    await seedSession(SESS_A, USER_REVOKE, T1, "active");
    await seedSession(SESS_B, USER_REVOKE, T1, "active");
    await seedSession(SESS_REVOKED, USER_REVOKE, T1, "revoked");
    await seedSession(SESS_OTHER, OTHER_USER, T1, "active");
  });

  it("revokes all active sessions for the user, leaves others, emits audit", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerSessionConsumers(q);
    await q.start();
    await q.publish("identity.session.revoke_all", {
      messageId: MSG_REVOKE_1, type: "identity.session.revoke_all", tenantId: T1,
      actorId: ACTOR, correlationId: "corr-revoke-1", schemaVersion: "1.0",
      timestamp: new Date().toISOString(), payload: { userId: USER_REVOKE },
    });
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await runWithTenant(T1, () => db.transaction(async (tx) =>
      tx.select().from(sessions).where(eq(sessions.userId, USER_REVOKE))));
    for (const r of rows) expect(r.status).toBe("revoked");

    // a different user's active session must be untouched
    const other = await runWithTenant(T1, () => db.transaction(async (tx) =>
      tx.select().from(sessions).where(eq(sessions.id, SESS_OTHER))));
    expect(other[0]?.status).toBe("active");

    const outbox = await runWithTenant(T1, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T1))));
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
    expect(outbox.map((r) => r.eventType)).toContain("identity.session.revoked_all");
  });

  it("is idempotent — a repeat (new messageId) finds nothing active and does not throw", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerSessionConsumers(q);
    await q.start();
    await q.publish("identity.session.revoke_all", {
      messageId: MSG_REVOKE_2, type: "identity.session.revoke_all", tenantId: T1,
      actorId: ACTOR, correlationId: "corr-revoke-2", schemaVersion: "1.0",
      timestamp: new Date().toISOString(), payload: { userId: USER_REVOKE },
    });
    await new Promise((r) => setTimeout(r, 400));
    await q.stop();

    const rows = await runWithTenant(T1, () => db.transaction(async (tx) =>
      tx.select().from(sessions).where(eq(sessions.userId, USER_REVOKE))));
    for (const r of rows) expect(r.status).toBe("revoked");
  });
});

describe("reset-password consumer — CQRS (integration)", () => {
  it("emits audit + password_reset_requested event via outbox", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerUserConsumers(q);
    await q.start();
    await q.publish("identity.user.reset_password", {
      messageId: MSG_RESET_1, type: "identity.user.reset_password", tenantId: T1,
      actorId: ACTOR, correlationId: "corr-reset-1", schemaVersion: "1.0",
      timestamp: new Date().toISOString(), payload: { id: USER_RESET },
    });
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const outbox = await runWithTenant(T1, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages)
        .where(and(eq(outboxMessages.tenantId, T1), eq(outboxMessages.eventType, "identity.user.password_reset_requested")))));
    expect(outbox.length).toBeGreaterThanOrEqual(1);

    const audit = await runWithTenant(T1, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages)
        .where(and(eq(outboxMessages.tenantId, T1), eq(outboxMessages.eventType, "audit.event.record")))));
    const actions = audit.map((r) => (r.payload as { action?: string }).action);
    expect(actions).toContain("reset_password");
  });
});
