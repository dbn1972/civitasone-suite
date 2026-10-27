/** notify-roles: GET /identity/internal/role-holders (who a role/desk notice must reach: ids only). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { users } from "../src/modules/users/schema.js";
import { roles, roleAssignments } from "../src/modules/rbac/schema.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "test-internal-service-secret-32chr";
const T = randomUUID();       // the tenant whose event raised the notice
const P = randomUUID();       // a platform tenant: operators live OUTSIDE T
const SEED = randomUUID();
const hdr = (tenant: string | null, secret = INTERNAL_SECRET) => ({ "x-internal": "1", ...(tenant ? { "x-tenant-id": tenant } : {}), "x-service-secret": secret });
const mk = () => randomUUID();
const sec = [mk(), mk(), mk()].sort();          // 3 active security_admin in T
const secSusp = mk(); const secRevoked = mk(); const clerk = mk(); const platOp = mk(); const platOpSusp = mk();
const R = { secT: mk(), clerkT: mk(), saP: mk(), paP: mk() };

let app: Awaited<ReturnType<typeof buildApp>>;
async function wipe() {
  for (const t of [T, P]) await runWithTenant(t, () => db.transaction(async (tx) => {
    await tx.delete(roleAssignments).where(eq(roleAssignments.tenantId, t));
    await tx.delete(roles).where(eq(roles.tenantId, t));
    await tx.delete(users).where(eq(users.tenantId, t));
  }));
}
const u = (id: string, tenantId: string, status = "active") => ({ id, tenantId, name: `U ${id.slice(0, 6)}`, email: `${id.slice(0, 8)}@dept.gov.in`, status, createdBy: SEED, updatedBy: SEED });
const asg = (tenantId: string, roleId: string, userId: string, status = "active") => ({ tenantId, roleId, userId, status, createdBy: SEED, updatedBy: SEED });

beforeAll(async () => {
  app = await buildApp();
  await wipe();
  await runWithTenant(T, () => db.transaction(async (tx) => {
    await tx.insert(users).values([...sec, secSusp, secRevoked, clerk].map((id) => u(id, T, id === secSusp ? "suspended" : "active")));
    await tx.insert(roles).values([
      { id: R.secT, tenantId: T, key: "security_admin", name: "Security Admin", isSystem: true, createdBy: SEED, updatedBy: SEED },
      { id: R.clerkT, tenantId: T, key: "clerk", name: "Clerk", isSystem: true, createdBy: SEED, updatedBy: SEED },
    ]);
    await tx.insert(roleAssignments).values([
      ...[...sec, secSusp].map((id) => asg(T, R.secT, id)), asg(T, R.secT, secRevoked, "revoked"), asg(T, R.clerkT, clerk),
    ]);
  }));
  await runWithTenant(P, () => db.transaction(async (tx) => {
    await tx.insert(users).values([u(platOp, P), u(platOpSusp, P, "suspended")]);
    await tx.insert(roles).values([
      { id: R.saP, tenantId: P, key: "super_admin", name: "Super Admin", isSystem: true, createdBy: SEED, updatedBy: SEED },
      { id: R.paP, tenantId: P, key: "platform_admin", name: "Platform Admin", isSystem: true, createdBy: SEED, updatedBy: SEED },
    ]);
    await tx.insert(roleAssignments).values([asg(P, R.paP, platOp), asg(P, R.paP, platOpSusp)]);
  }));
});
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

const get = (qs: string, headers = hdr(T)) => app.inject({ method: "GET", url: `/identity/internal/role-holders?${qs}`, headers });

describe("GET /identity/internal/role-holders", () => {
  it("tenant scope: ACTIVE holders of the role in the calling tenant, ids only", async () => {
    const res = await get("scope=tenant&roles=security_admin");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: sec.map((userId) => ({ userId, tenantId: T })), nextCursor: null });
  });

  it("is paginated by a keyset cursor and never repeats or drops a holder", async () => {
    const p1 = (await get("scope=tenant&roles=security_admin&limit=2")).json();
    expect(p1.data.map((d: { userId: string }) => d.userId)).toEqual(sec.slice(0, 2));
    expect(p1.nextCursor).toBe(sec[1]);
    const p2 = (await get(`scope=tenant&roles=security_admin&limit=2&after=${p1.nextCursor}`)).json();
    expect(p2.data.map((d: { userId: string }) => d.userId)).toEqual(sec.slice(2));
    expect(p2.nextCursor).toBeNull();
  });

  it("platform scope: platform-role holders from OTHER tenants, active only", async () => {
    const res = await get("scope=platform&roles=platform_admin,super_admin");
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toContainEqual({ userId: platOp, tenantId: P });
    expect(JSON.stringify(res.json())).not.toContain(platOpSusp);
    expect(JSON.stringify(res.json())).not.toContain(sec[0]);
  });

  it("platform scope refuses a non-platform role (no cross-tenant read of ordinary roles)", async () => {
    expect((await get("scope=platform&roles=security_admin")).statusCode).toBe(400);
  });

  it("tenant_all: every ACTIVE user of the calling tenant and no other tenant", async () => {
    const ids = (await get("scope=tenant_all")).json().data.map((d: { userId: string }) => d.userId);
    expect(ids.sort()).toEqual([...sec, secRevoked, clerk].sort());
  });

  it("a role nobody holds is an empty page, not an error; bad input is a 400", async () => {
    expect((await get("scope=tenant&roles=no_such_role")).json()).toEqual({ data: [], nextCursor: null });
    expect((await get("scope=tenant")).statusCode).toBe(400);
    expect((await get("scope=tenant&roles=Bad%20Key")).statusCode).toBe(400);
    expect((await get("scope=tenant&roles=clerk&after=not-a-uuid")).statusCode).toBe(400);
  });

  it("needs the internal service credential", async () => {
    expect((await app.inject({ method: "GET", url: "/identity/internal/role-holders?roles=clerk" })).statusCode).toBe(401);
    expect((await get("roles=clerk", hdr(T, "wrong-secret"))).statusCode).toBe(401);
    const emp = { authorization: `Bearer ${signToken({ sub: "e", tid: T, roles: ["employee"], sid: "s" }, SECRET, 3600)}` };
    expect([401, 403]).toContain((await get("roles=clerk", emp as never)).statusCode);
  });
});
