/**
 * GAP-ADMIN-USERS-03 (server-side search + real total) and GAP-ADMIN-USERS-01
 * (never strand a tenant without an active tenant admin). Real Postgres as the
 * non-superuser app role (FORCE RLS), real Fastify and real consumer.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { users } from "../src/modules/users/schema.js";
import { roles, roleAssignments } from "../src/modules/rbac/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerUserConsumers } from "../src/modules/users/consumer.js";
import { registerRbacConsumers } from "../src/modules/rbac/consumer.js";
import { randomUUID } from "node:crypto";
import { escapeLike } from "../src/modules/users/repo.js";
import { wouldStrandTenantAdmins } from "../src/modules/users/domain.js";

const SECRET = process.env.JWT_SECRET as string;
const T = "5e7b0000-0000-4000-8000-0000000000a1";
const T2 = "5e7b0000-0000-4000-8000-0000000000b1";
const ACTOR = "5e7bacc0-0000-4000-8000-0000000000a1";
const ADMIN_A = "5e7b1000-0000-4000-8000-00000000000a";
const ADMIN_B = "5e7b1000-0000-4000-8000-00000000000b";
const ROLE = "5e7b2000-0000-4000-8000-000000000001";
const uid = (n: number) => `5e7b3000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const bearer = (roles: string[], tid = T) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, roles, tid } as never, SECRET)}` });

type AppT = Awaited<ReturnType<(typeof import("../src/app.js"))["buildApp"]>>;
let app: AppT;

function tenantQueue(): Queue {
  const q = new MemoryQueue();
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}
const allIds = [ADMIN_A, ADMIN_B, ...Array.from({ length: 60 }, (_, i) => uid(i + 1))];

async function wipe() {
  for (const t of [T, T2]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(roleAssignments).where(eq(roleAssignments.tenantId, t));
      await tx.delete(roles).where(eq(roles.tenantId, t));
      await tx.delete(users).where(eq(users.tenantId, t));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    }));
  }
  await runWithTenant(T, () => db.transaction((tx) => tx.delete(processed).where(inArray(processed.messageId, ["5e7bd000-0000-4000-8000-000000000001", "5e7bd000-0000-4000-8000-000000000002"]))));
}
async function seed() {
  await runWithTenant(T, () => db.transaction(async (tx) => {
    const mk = (id: string, name: string, email: string, empCode: string | null, status = "active") =>
      ({ id, tenantId: T, name, email, empCode, status, createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(users).values([
      mk(ADMIN_A, "Admin Alpha", "alpha@dept.gov.in", "EA-1"),
      mk(ADMIN_B, "Admin Beta", "beta@dept.gov.in", "EA-2"),
      ...Array.from({ length: 60 }, (_, i) => mk(uid(i + 1), `Clerk ${String(i + 1).padStart(2, "0")}`, `clerk${i + 1}@dept.gov.in`, `C-${i + 1}`, i < 5 ? "suspended" : i < 8 ? "deactivated" : "active")),
    ]);
    await tx.insert(users).values({ ...mk(uid(99), "Fifty 50% Off", "fifty@dept.gov.in", null), id: uid(99) });
    await tx.insert(roles).values({ id: ROLE, tenantId: T, key: "tenant_admin", name: "Tenant Admin", isSystem: true, createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(roleAssignments).values([ADMIN_A, ADMIN_B].map((userId) => ({ tenantId: T, roleId: ROLE, userId, status: "active", createdBy: ACTOR, updatedBy: ACTOR })));
  }));
  await runWithTenant(T2, () => db.transaction((tx) => tx.insert(users).values({ id: uid(500), tenantId: T2, name: "Clerk Elsewhere", email: "x@other.gov.in", status: "active", createdBy: ACTOR, updatedBy: ACTOR })));
}

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await wipe();
  await seed();
});
afterAll(async () => { await wipe(); await runWithTenant(T2, () => db.transaction((tx) => tx.delete(users).where(eq(users.id, uid(500))))); await app.close(); await sqlClient.end(); });

const search = (qs: string, headers = bearer(["tenant_admin"])) => app.inject({ method: "GET", url: `/identity/users/search?${qs}`, headers });

describe("GET /identity/users/search (USERS-03)", () => {
  it("returns one page, the real total beyond it, and tenant-wide status counts", async () => {
    const res = await search("limit=25&offset=0");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(25);
    expect(body.total).toBe(63); // 2 admins + 60 clerks + 1 "Fifty"
    expect(body.counts).toEqual({ active: 55, suspended: 5, locked: 0, deactivated: 3 });
  });

  it("pages are stable and do not overlap", async () => {
    const [p1, p2, p3] = await Promise.all([search("limit=25&offset=0"), search("limit=25&offset=25"), search("limit=25&offset=50")]);
    const ids = [...p1.json().rows, ...p2.json().rows, ...p3.json().rows].map((r: { id: string }) => r.id);
    expect(ids).toHaveLength(63);
    expect(new Set(ids).size).toBe(63);
  });

  it("filters by name, email and employee code, case-insensitively, with the filtered total", async () => {
    expect((await search("q=clerk 1")).json().total).toBe(10); // Clerk 10..Clerk 19
    expect((await search("q=ALPHA@dept")).json().rows.map((r: { id: string }) => r.id)).toEqual([ADMIN_A]);
    expect((await search("q=EA-2")).json().rows.map((r: { id: string }) => r.id)).toEqual([ADMIN_B]);
    const sus = (await search("status=suspended&limit=200")).json();
    expect(sus.total).toBe(5);
    expect(sus.rows.every((r: { status: string }) => r.status === "suspended")).toBe(true);
  });

  it("treats LIKE wildcards literally", async () => {
    const r = (await search("q=" + encodeURIComponent("50%"))).json();
    expect(r.total).toBe(1);
    expect(r.rows[0].id).toBe(uid(99));
    expect((await search("q=" + encodeURIComponent("%"))).json().total).toBe(1);
    expect(escapeLike("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
  });

  it("never returns another tenant's users and enforces role and bounds", async () => {
    expect((await search("q=Elsewhere")).json().total).toBe(0);
    expect((await search("limit=25", bearer(["employee"]))).statusCode).toBe(403);
    expect((await search("limit=500")).statusCode).toBe(400);
    expect((await search("status=nonsense")).statusCode).toBe(400);
    expect((await search(`tenantId=${T2}`)).statusCode).toBe(403);
  });
});

describe("last active tenant admin guard (USERS-01)", () => {
  it("the pure rule: strands only when the target is an admin and no other active admin remains", () => {
    expect(wouldStrandTenantAdmins(["a", "b"], ["a", "b"], "a")).toBe(false);
    expect(wouldStrandTenantAdmins(["a", "b"], ["a"], "a")).toBe(true);
    expect(wouldStrandTenantAdmins(["a"], ["a"], "a")).toBe(true);
    expect(wouldStrandTenantAdmins(["a"], ["a"], "z")).toBe(false);
    expect(wouldStrandTenantAdmins([], [], "a")).toBe(false);
  });

  it("route: allows suspending a non-admin and the first of two admins, refuses the last one with 409", async () => {
    const suspend = (id: string) => app.inject({ method: "PATCH", url: `/identity/users/${id}/status`, headers: bearer(["tenant_admin"]), payload: { status: "suspended", reason: "test reason" } });
    expect((await suspend(uid(20))).statusCode).toBe(202);
    expect((await suspend(ADMIN_A)).statusCode).toBe(202); // B remains
    // Simulate A having been suspended, then B is the last active admin.
    await runWithTenant(T, () => db.transaction((tx) => tx.update(users).set({ status: "suspended" }).where(eq(users.id, ADMIN_A))));
    const last = await suspend(ADMIN_B);
    expect(last.statusCode).toBe(409);
    expect(last.json().code).toBe("LAST_TENANT_ADMIN");
    const del = await app.inject({ method: "DELETE", url: `/identity/users/${ADMIN_B}`, headers: bearer(["tenant_admin"]) });
    expect(del.statusCode).toBe(409);
    // re-activating is never blocked
    await runWithTenant(T, () => db.transaction((tx) => tx.update(users).set({ status: "active" }).where(eq(users.id, ADMIN_A))));
  });

  it("consumer: two admins suspended at the same moment, only one change lands and the other is denied + audited", async () => {
    await runWithTenant(T, () => db.transaction((tx) => tx.update(users).set({ status: "active" }).where(inArray(users.id, [ADMIN_A, ADMIN_B]))));
    const q = tenantQueue();
    registerUserConsumers(q);
    await q.start();
    const cmd = (messageId: string, id: string) => q.publish("identity.user.deactivate", {
      messageId, type: "identity.user.deactivate", tenantId: T, actorId: ACTOR, correlationId: "corr-last-admin",
      schemaVersion: "1.0", timestamp: new Date().toISOString(), payload: { id, status: "suspended", reason: "race" },
    });
    await Promise.all([cmd("5e7bd000-0000-4000-8000-000000000001", ADMIN_A), cmd("5e7bd000-0000-4000-8000-000000000002", ADMIN_B)]);
    await new Promise((r) => setTimeout(r, 1200));
    await q.stop();
    const rows = await runWithTenant(T, () => db.transaction((tx) => tx.select().from(users).where(inArray(users.id, [ADMIN_A, ADMIN_B]))));
    expect(rows.filter((r) => r.status === "suspended")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
    const audits = await runWithTenant(T, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T))));
    const denied = audits.filter((r) => (r.payload as { reason?: string }).reason === "LAST_TENANT_ADMIN");
    expect(denied).toHaveLength(1);
    expect(denied[0]!.payload).toMatchObject({ outcome: "denied", severity: "high" });
  });
});

describe("role revocation honours the last-admin guard (USERS-01)", () => {
  const revokeCmd = (q: Queue, userId: string) => q.publish("identity.rbac.role.revoke", {
    messageId: randomUUID(), type: "identity.rbac.role.revoke", tenantId: T, actorId: ACTOR, correlationId: "corr-revoke",
    schemaVersion: "1.0", timestamp: new Date().toISOString(), payload: { roleId: ROLE, userId, reason: "test" },
  });
  const suspendCmd = (q: Queue, id: string) => q.publish("identity.user.deactivate", {
    messageId: randomUUID(), type: "identity.user.deactivate", tenantId: T, actorId: ACTOR, correlationId: "corr-susp",
    schemaVersion: "1.0", timestamp: new Date().toISOString(), payload: { id, status: "suspended", reason: "race" },
  });
  const assignments = () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(roleAssignments).where(eq(roleAssignments.roleId, ROLE))));
  const reset = () => runWithTenant(T, () => db.transaction(async (tx) => {
    await tx.update(users).set({ status: "active" }).where(inArray(users.id, [ADMIN_A, ADMIN_B]));
    await tx.update(roleAssignments).set({ status: "active" }).where(eq(roleAssignments.roleId, ROLE));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T));
  }));
  const deniedAudits = async () => (await runWithTenant(T, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T)))))
    .filter((r) => (r.payload as { reason?: string }).reason === "LAST_TENANT_ADMIN");

  it("route: revoking one of two admins is accepted, revoking the last active one is a 409 (also via DELETE assignment)", async () => {
    await reset();
    const revoke = (uid: string) => app.inject({ method: "DELETE", url: `/identity/rbac/roles/${ROLE}/assignments/${uid}`, headers: bearer(["super_admin"]), payload: {} });
    expect((await revoke(ADMIN_A)).statusCode).toBe(202); // B remains
    await runWithTenant(T, () => db.transaction((tx) => tx.update(roleAssignments).set({ status: "revoked" }).where(eq(roleAssignments.userId, ADMIN_A))));
    const last = await revoke(ADMIN_B);
    expect(last.statusCode).toBe(409);
    expect(last.json().code).toBe("LAST_TENANT_ADMIN");
  });

  it("consumer: the last active admin keeps the role; the attempt is denied and audited", async () => {
    await reset();
    await runWithTenant(T, () => db.transaction((tx) => tx.update(roleAssignments).set({ status: "revoked" }).where(eq(roleAssignments.userId, ADMIN_A))));
    const q = tenantQueue();
    registerRbacConsumers(q);
    await q.start();
    await revokeCmd(q, ADMIN_B);
    await new Promise((r) => setTimeout(r, 800));
    await q.stop();
    expect((await assignments()).find((a) => a.userId === ADMIN_B)!.status).toBe("active");
    expect(await deniedAudits()).toHaveLength(1);
  });

  it("an inactive admin can be revoked even when no active admin remains (nothing is stranded)", async () => {
    await reset();
    await runWithTenant(T, () => db.transaction((tx) => tx.update(users).set({ status: "suspended" }).where(eq(users.id, ADMIN_A))));
    const q = tenantQueue();
    registerRbacConsumers(q);
    await q.start();
    await revokeCmd(q, ADMIN_A);
    await new Promise((r) => setTimeout(r, 800));
    await q.stop();
    expect((await assignments()).find((a) => a.userId === ADMIN_A)!.status).toBe("revoked");
  });

  it("concurrent revoke(A) vs suspend(B): the tenant is never left without an active admin", async () => {
    for (let round = 0; round < 3; round++) {
      await reset();
      const q = tenantQueue();
      registerRbacConsumers(q);
      registerUserConsumers(q);
      await q.start();
      await Promise.all([revokeCmd(q, ADMIN_A), suspendCmd(q, ADMIN_B)]);
      await new Promise((r) => setTimeout(r, 1200));
      await q.stop();
      const us = await runWithTenant(T, () => db.transaction((tx) => tx.select().from(users).where(inArray(users.id, [ADMIN_A, ADMIN_B]))));
      const as = await assignments();
      const stillAdmin = [ADMIN_A, ADMIN_B].filter((id) =>
        us.find((u) => u.id === id)!.status === "active" && as.find((a) => a.userId === id)!.status === "active");
      expect(stillAdmin.length, `round ${round}`).toBeGreaterThanOrEqual(1);
      expect(await deniedAudits(), `round ${round}`).toHaveLength(1);
    }
  });

  it("a lock persists (users_status_check allows 'locked', migration 0027) and a locked user can be re-activated", async () => {
    const q = tenantQueue();
    registerUserConsumers(q);
    await q.start();
    const set = (status: string) => q.publish("identity.user.deactivate", {
      messageId: randomUUID(), type: "identity.user.deactivate", tenantId: T, actorId: ACTOR, correlationId: "corr-lock",
      schemaVersion: "1.0", timestamp: new Date().toISOString(), payload: { id: uid(30), status },
    });
    await set("locked");
    await new Promise((r) => setTimeout(r, 600));
    const read = () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(users).where(eq(users.id, uid(30)))));
    expect((await read())[0]!.status).toBe("locked");
    await set("active");
    await new Promise((r) => setTimeout(r, 600));
    await q.stop();
    expect((await read())[0]!.status).toBe("active");
  });
});
