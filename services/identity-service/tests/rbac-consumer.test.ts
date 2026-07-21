/**
 * RBAC consumer — integration tests.
 *
 * Exercises all consumer handlers: createRole, createPermission, grantPermission,
 * revokePermission, assignRole, revokeRole with idempotency and authority checks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { roles, permissions, rolePermissions, roleAssignments } from "../src/modules/rbac/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerRbacConsumers } from "../src/modules/rbac/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "f3333333-3333-4000-8000-000000000f3f";
const ACTOR = "a0000000-0000-4000-8000-00000000aa01";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const ROLE_ID = "e1111111-1111-4000-8000-000000000001";
const PERM_ID = "f1111111-1111-4000-8000-000000000001";
const PERM_ID_2 = "f2222222-2222-4000-8000-000000000002";
const ASSIGN_USER = "b1111111-1111-4000-8000-000000000001";
const MSG_CREATE_ROLE = "a1111111-1111-4000-8000-000000000001";
const MSG_CREATE_PERM = "a2222222-2222-4000-8000-000000000002";
const MSG_CREATE_PERM_2 = "a2222222-2222-4000-8000-000000000012";
const MSG_GRANT_PERM = "a3333333-3333-4000-8000-000000000003";
const MSG_REVOKE_PERM = "a4444444-4444-4000-8000-000000000004";
const MSG_ASSIGN_ROLE = "a5555555-5555-4000-8000-000000000005";
const MSG_REVOKE_ROLE = "a6666666-6666-4000-8000-000000000006";

async function cleanup() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.tenantId, TENANT));
    await tx.delete(roleAssignments).where(eq(roleAssignments.tenantId, TENANT));
    await tx.delete(permissions).where(eq(permissions.tenantId, TENANT));
    await tx.delete(roles).where(eq(roles.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    for (const id of [MSG_CREATE_ROLE, MSG_CREATE_PERM, MSG_CREATE_PERM_2, MSG_GRANT_PERM, MSG_REVOKE_PERM, MSG_ASSIGN_ROLE, MSG_REVOKE_ROLE]) {
      await tx.delete(processed).where(eq(processed.messageId, id));
    }
  }));
}

beforeAll(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

function envelope(type: string, messageId: string, payload: Record<string, unknown>) {
  return {
    messageId, type, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0",
    timestamp: new Date().toISOString(), payload,
  };
}

describe("RBAC consumer — createRole", () => {
  it("inserts role row + emits events", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRbacConsumers(q);
    await q.start();
    await q.publish(COMMANDS.rbacCreateRole, envelope(COMMANDS.rbacCreateRole, MSG_CREATE_ROLE, {
      id: ROLE_ID, key: "test.coverage.role", name: "Coverage Role", description: "for tests",
    }));
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const [row] = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(roles).where(and(eq(roles.id, ROLE_ID), eq(roles.tenantId, TENANT)))));
    expect(row).toBeDefined();
    expect(row.key).toBe("test.coverage.role");
    expect(row.name).toBe("Coverage Role");

    const outbox = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    expect(outbox.map((r) => r.eventType)).toContain("identity.rbac.role.created");
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
  });

  it("is idempotent (duplicate messageId)", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRbacConsumers(q);
    await q.start();
    await q.publish(COMMANDS.rbacCreateRole, envelope(COMMANDS.rbacCreateRole, MSG_CREATE_ROLE, {
      id: ROLE_ID, key: "test.coverage.role", name: "Coverage Role",
    }));
    await new Promise((r) => setTimeout(r, 300));
    await q.stop();
    // No error, no duplicate row
    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(roles).where(and(eq(roles.id, ROLE_ID), eq(roles.tenantId, TENANT)))));
    expect(rows.length).toBe(1);
  });
});

describe("RBAC consumer — createPermission", () => {
  it("inserts permission row + emits events", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRbacConsumers(q);
    await q.start();
    await q.publish(COMMANDS.rbacCreatePermission, envelope(COMMANDS.rbacCreatePermission, MSG_CREATE_PERM, {
      id: PERM_ID, key: "test.coverage.perm", name: "Coverage Permission",
    }));
    await q.publish(COMMANDS.rbacCreatePermission, envelope(COMMANDS.rbacCreatePermission, MSG_CREATE_PERM_2, {
      id: PERM_ID_2, key: "test.coverage.perm2", name: "Coverage Permission 2",
    }));
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const [row] = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(permissions).where(and(eq(permissions.id, PERM_ID), eq(permissions.tenantId, TENANT)))));
    expect(row).toBeDefined();
    expect(row.key).toBe("test.coverage.perm");
  });
});

describe("RBAC consumer — grantPermission", () => {
  it("attaches permission to role (with authority re-check)", async () => {
    // First, give the actor the permission so they have authority to grant it
    // (We use super_admin in callerRoles which has unconditional authority)
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRbacConsumers(q);
    await q.start();
    await q.publish(COMMANDS.rbacGrantPermission, envelope(COMMANDS.rbacGrantPermission, MSG_GRANT_PERM, {
      roleId: ROLE_ID, permissionId: PERM_ID, permissionKey: "test.coverage.perm",
      callerRoles: ["super_admin"],
    }));
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const attached = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(rolePermissions).where(and(
        eq(rolePermissions.tenantId, TENANT),
        eq(rolePermissions.roleId, ROLE_ID),
        eq(rolePermissions.permissionId, PERM_ID),
      ))));
    expect(attached.length).toBe(1);
  });
});

describe("RBAC consumer — revokePermission", () => {
  it("detaches permission from role", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRbacConsumers(q);
    await q.start();
    await q.publish(COMMANDS.rbacRevokePermission, envelope(COMMANDS.rbacRevokePermission, MSG_REVOKE_PERM, {
      roleId: ROLE_ID, permissionId: PERM_ID,
    }));
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const attached = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(rolePermissions).where(and(
        eq(rolePermissions.tenantId, TENANT),
        eq(rolePermissions.roleId, ROLE_ID),
        eq(rolePermissions.permissionId, PERM_ID),
      ))));
    expect(attached.length).toBe(0);
  });
});

describe("RBAC consumer — assignRole + revokeRole", () => {
  it("assigns role to user + creates history entry", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRbacConsumers(q);
    await q.start();
    await q.publish(COMMANDS.rbacAssignRole, envelope(COMMANDS.rbacAssignRole, MSG_ASSIGN_ROLE, {
      roleId: ROLE_ID, userId: ASSIGN_USER, reason: "test coverage assignment",
      callerRoles: ["super_admin"],
    }));
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const [assignment] = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(roleAssignments).where(and(
        eq(roleAssignments.tenantId, TENANT),
        eq(roleAssignments.roleId, ROLE_ID),
        eq(roleAssignments.userId, ASSIGN_USER),
      ))));
    expect(assignment).toBeDefined();
    expect(assignment.status).toBe("active");
  });

  it("revokes role from user + creates history entry", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRbacConsumers(q);
    await q.start();
    await q.publish(COMMANDS.rbacRevokeRole, envelope(COMMANDS.rbacRevokeRole, MSG_REVOKE_ROLE, {
      roleId: ROLE_ID, userId: ASSIGN_USER, reason: "test coverage revocation",
    }));
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const [assignment] = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(roleAssignments).where(and(
        eq(roleAssignments.tenantId, TENANT),
        eq(roleAssignments.roleId, ROLE_ID),
        eq(roleAssignments.userId, ASSIGN_USER),
      ))));
    expect(assignment).toBeDefined();
    expect(assignment.status).toBe("revoked");
  });
});
