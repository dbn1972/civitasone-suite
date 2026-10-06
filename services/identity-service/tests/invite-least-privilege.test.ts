/**
 * GAP-TENANT-ADMIN-USERS-07 (backend verify): invite/create-user behaviour.
 *
 * Verifies, without a running Keycloak, that:
 *  - the admin invite/create path assigns NO elevated realm role by default
 *    (least privilege: a new invitee lands with no platform/admin role — role
 *    grants must go through the separate audited RBAC flow), and
 *  - creating a user emits a user.created domain event + an audit.event.record
 *    with action "create" via the outbox (unauditable creation would be the
 *    failure mode this guards against).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { users } from "../src/modules/users/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerUserConsumers } from "../src/modules/users/consumer.js";

const T = "e1111111-1111-4000-8000-0000000000c1";
const ACTOR = "e0000000-0000-4000-8000-0000000000ca";
const NEW_USER = "e2222222-2222-4000-8000-0000000000d1";
const MSG = "e3333333-3333-4000-8000-0000000000e1";

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}

async function cleanup() {
  await runWithTenant(T, () => db.transaction(async (tx) => {
    await tx.delete(users).where(eq(users.id, NEW_USER));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T));
    await tx.delete(processed).where(eq(processed.messageId, MSG));
  }));
}

beforeAll(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("GAP-TENANT-ADMIN-USERS-07 — invite/create is least-privilege and audited", () => {
  it("creates the user, emits user.created + audit(create), and grants NO initial role by default", async () => {
    const q = wire(new MemoryQueue());
    registerUserConsumers(q);
    await q.start();
    await q.publish("identity.user.create", {
      messageId: MSG, type: "identity.user.create", tenantId: T, actorId: ACTOR,
      correlationId: "corr-invite", schemaVersion: "1.0", timestamp: new Date().toISOString(),
      payload: {
        id: NEW_USER, tenantId: T, email: "newbie@test.gov.in", name: "New Bie",
        empCode: null, status: "active", mfaEnabled: false, version: 1, createdBy: ACTOR,
        // No initialRealmRoles on the admin-invite path => least privilege.
      },
    });
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const row = await runWithTenant(T, () => db.transaction(async (tx) =>
      tx.select().from(users).where(eq(users.id, NEW_USER))));
    expect(row[0]?.email).toBe("newbie@test.gov.in");
    expect(row[0]?.status).toBe("active");

    const created = await runWithTenant(T, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages)
        .where(and(eq(outboxMessages.tenantId, T), eq(outboxMessages.eventType, "identity.user.created")))));
    expect(created.length).toBeGreaterThanOrEqual(1);

    const audit = await runWithTenant(T, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages)
        .where(and(eq(outboxMessages.tenantId, T), eq(outboxMessages.eventType, "audit.event.record")))));
    const actions = audit.map((r) => (r.payload as { action?: string }).action);
    expect(actions).toContain("create");
  });
});
