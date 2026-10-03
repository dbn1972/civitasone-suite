/** GAP-ADMIN-INVOICES-06: GET /identity/internal/tenant-admins (recipients for invoice reminders). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { users } from "../src/modules/users/schema.js";
import { roles, roleAssignments } from "../src/modules/rbac/schema.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "test-internal-service-secret-32chr";
const T = "5e8b0000-0000-4000-8000-0000000000a1";
const T2 = "5e8b0000-0000-4000-8000-0000000000b1";
const SEED = "5e8b0000-0000-4000-8000-000000000099";
const ids = { a1: "5e8b1000-0000-4000-8000-00000000000a", a2: "5e8b1000-0000-4000-8000-00000000000b", susp: "5e8b1000-0000-4000-8000-00000000000c", revoked: "5e8b1000-0000-4000-8000-00000000000d", clerk: "5e8b1000-0000-4000-8000-00000000000e", other: "5e8b1000-0000-4000-8000-00000000000f" };
const ROLE = "5e8b2000-0000-4000-8000-000000000001";
const ROLE2 = "5e8b2000-0000-4000-8000-000000000002";
const hdr = (tenant: string | null, secret = INTERNAL_SECRET) => ({ "x-internal": "1", ...(tenant ? { "x-tenant-id": tenant } : {}), "x-service-secret": secret });

let app: Awaited<ReturnType<typeof buildApp>>;
async function wipe() {
  for (const t of [T, T2]) await runWithTenant(t, () => db.transaction(async (tx) => {
    await tx.delete(roleAssignments).where(eq(roleAssignments.tenantId, t));
    await tx.delete(roles).where(eq(roles.tenantId, t));
    await tx.delete(users).where(eq(users.tenantId, t));
  }));
}
beforeAll(async () => {
  app = await buildApp();
  await wipe();
  const u = (id: string, tenantId: string, name: string, email: string, status = "active") => ({ id, tenantId, name, email, status, createdBy: SEED, updatedBy: SEED });
  await runWithTenant(T, () => db.transaction(async (tx) => {
    await tx.insert(users).values([
      u(ids.a1, T, "Asha Rao", "asha@dept.gov.in"), u(ids.a2, T, "Vikram Iyer", "vikram@dept.gov.in"),
      u(ids.susp, T, "Suspended Admin", "susp@dept.gov.in", "suspended"), u(ids.revoked, T, "Revoked Admin", "rev@dept.gov.in"), u(ids.clerk, T, "Clerk", "clerk@dept.gov.in"),
    ]);
    await tx.insert(roles).values({ id: ROLE, tenantId: T, key: "tenant_admin", name: "Tenant Admin", isSystem: true, createdBy: SEED, updatedBy: SEED });
    await tx.insert(roleAssignments).values([ids.a1, ids.a2, ids.susp].map((userId) => ({ tenantId: T, roleId: ROLE, userId, status: "active", createdBy: SEED, updatedBy: SEED })));
    await tx.insert(roleAssignments).values({ tenantId: T, roleId: ROLE, userId: ids.revoked, status: "revoked", createdBy: SEED, updatedBy: SEED });
  }));
  await runWithTenant(T2, () => db.transaction(async (tx) => {
    await tx.insert(users).values(u(ids.other, T2, "Other Tenant Admin", "other@else.gov.in"));
    await tx.insert(roles).values({ id: ROLE2, tenantId: T2, key: "tenant_admin", name: "Tenant Admin", isSystem: true, createdBy: SEED, updatedBy: SEED });
    await tx.insert(roleAssignments).values({ tenantId: T2, roleId: ROLE2, userId: ids.other, status: "active", createdBy: SEED, updatedBy: SEED });
  }));
});
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("GET /identity/internal/tenant-admins", () => {
  it("returns only ACTIVE tenant_admin users of the calling tenant, with id, name and email and nothing else", async () => {
    const res = await app.inject({ method: "GET", url: "/identity/internal/tenant-admins", headers: hdr(T) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: ids.a1, name: "Asha Rao", email: "asha@dept.gov.in" },
      { id: ids.a2, name: "Vikram Iyer", email: "vikram@dept.gov.in" },
    ]);
    const other = await app.inject({ method: "GET", url: "/identity/internal/tenant-admins", headers: hdr(T2) });
    expect(other.json()).toEqual([{ id: ids.other, name: "Other Tenant Admin", email: "other@else.gov.in" }]);
  });

  it("needs the internal service credential and a well-formed tenant", async () => {
    expect((await app.inject({ method: "GET", url: "/identity/internal/tenant-admins" })).statusCode).toBe(401);
    const emp = { authorization: `Bearer ${signToken({ sub: "e", tid: T, roles: ["employee"], sid: "s" }, SECRET, 3600)}` };
    expect([401, 403]).toContain((await app.inject({ method: "GET", url: "/identity/internal/tenant-admins", headers: emp })).statusCode);
    expect((await app.inject({ method: "GET", url: "/identity/internal/tenant-admins", headers: hdr(T, "wrong-secret") })).statusCode).toBe(401);
    // no tenant on an internal call: the auth layer refuses it before the route runs
    expect((await app.inject({ method: "GET", url: "/identity/internal/tenant-admins", headers: hdr(null) })).statusCode).toBe(401);
  });

  it("a tenant with no admin returns an empty list, not an error", async () => {
    const res = await app.inject({ method: "GET", url: "/identity/internal/tenant-admins", headers: hdr("5e8b0000-0000-4000-8000-0000000000ff") });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
