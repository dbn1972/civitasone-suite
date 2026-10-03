/**
 * GAP-ADMIN-OPERATORS-05 (review round): every other way to change a platform operator is closed.
 * Direct status route (including reactivation of a SUSPENDED operator), SCIM PUT / PATCH / DELETE, and
 * RBAC role assignment / revocation (self-promotion, promoting an operator, creating a new one) all
 * refuse at the route AND again in the consumer; a new operator is made through a `grant` request.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerOperatorConsumers } from "../src/modules/operators/consumer.js";
import { registerUserConsumers } from "../src/modules/users/consumer.js";
import { registerRbacConsumers } from "../src/modules/rbac/consumer.js";
import { registerScimConsumers } from "../src/modules/scim/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// SCIM resolves its tenant from the token; the legacy token is bound to SCIM_TENANT_ID.
const T = process.env.SCIM_TENANT_ID as string;
const LEGACY_TOKEN = process.env.SCIM_BEARER_TOKEN as string;
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET as string;
const id = (n: number) => `${T.slice(0, 24)}${String(900 + n).padStart(12, "0")}`;
const A = id(1), B = id(2), P = id(3), S = id(4), PLAIN = id(5);
const ROLE_SUPER = id(20), ROLE_PLAT = id(21);

let app: FastifyInstance;
const drain = () => (queue as unknown as { drain?: () => Promise<void> }).drain?.();
const hdr = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: T, roles, sid: "sess-bypass" }, SECRET, 3600)}` });
const scimHdr = { "x-internal": "1", "x-service-secret": INTERNAL_SECRET, "x-tenant-id": T, authorization: `Bearer ${LEGACY_TOKEN}` };

async function asTenant<R>(fn: (q: typeof sqlClient) => Promise<R>): Promise<R> {
  return (await sqlClient.begin(async (q) => {
    await q`SELECT set_config('app.tenant_id', ${T}, true)`;
    return fn(q as unknown as typeof sqlClient);
  })) as R;
}
async function seed() {
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${T}`;
  await asTenant(async (q) => {
    await q`DELETE FROM users.operator_change_requests WHERE tenant_id = ${T} AND target_user_id IN (${A}, ${B}, ${P}, ${S}, ${PLAIN})`;
    await q`DELETE FROM rbac.role_assignment_history WHERE tenant_id = ${T} AND user_id IN (${A}, ${B}, ${P}, ${S}, ${PLAIN})`;
    await q`DELETE FROM rbac.role_assignments WHERE tenant_id = ${T} AND user_id IN (${A}, ${B}, ${P}, ${S}, ${PLAIN})`;
    await q`DELETE FROM rbac.roles WHERE id IN (${ROLE_SUPER}, ${ROLE_PLAT})`;
    await q`DELETE FROM users.users WHERE id IN (${A}, ${B}, ${P}, ${S}, ${PLAIN})`;
    for (const [uid, name, status] of [[A, "Bp Asha", "active"], [B, "Bp Bimal", "active"], [P, "Bp Pavan", "active"], [S, "Bp Suspended", "suspended"], [PLAIN, "Bp Plain", "active"]] as const) {
      await q`INSERT INTO users.users (id, tenant_id, email, name, status, created_by, updated_by) VALUES (${uid}, ${T}, ${uid + "@dept.gov.in"}, ${name}, ${status}, ${A}, ${A})`;
    }
    await q`INSERT INTO rbac.roles (id, tenant_id, key, name, is_system, created_by, updated_by) VALUES (${ROLE_SUPER}, ${T}, 'super_admin', 'Super Admin', true, ${A}, ${A})`;
    await q`INSERT INTO rbac.roles (id, tenant_id, key, name, is_system, created_by, updated_by) VALUES (${ROLE_PLAT}, ${T}, 'platform_admin', 'Platform Admin', true, ${A}, ${A})`;
    for (const [uid, rid] of [[A, ROLE_SUPER], [B, ROLE_SUPER], [P, ROLE_PLAT], [S, ROLE_PLAT]] as const) {
      await q`INSERT INTO rbac.role_assignments (tenant_id, role_id, user_id, created_by, updated_by) VALUES (${T}, ${rid}, ${uid}, ${A}, ${A})`;
    }
  });
}
const userRow = (uid: string) => asTenant(async (q) => (await q<Array<{ status: string; name: string }>>`SELECT status, name FROM users.users WHERE id = ${uid}`)[0]!);
const roleKeys = (uid: string) => asTenant(async (q) =>
  (await q<Array<{ key: string }>>`SELECT r.key FROM rbac.role_assignments ra JOIN rbac.roles r ON r.id = ra.role_id WHERE ra.user_id = ${uid} AND ra.status = 'active' ORDER BY r.key`).map((r) => r.key));
async function audits(action: string, resourceId: string) {
  const rows = await sqlClient<Array<{ payload: unknown }>>`SELECT payload FROM _outbox.messages WHERE tenant_id = ${T} AND topic = 'audit.event.record'`;
  return rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>)
    .filter((p) => p.action === action && p.resourceId === resourceId);
}
const env = (type: string, actorId: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type, tenantId: T, actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload,
});

beforeAll(async () => {
  registerOperatorConsumers(queue); registerUserConsumers(queue); registerRbacConsumers(queue); registerScimConsumers(queue);
  await queue.start();
  app = await buildApp();
});
beforeEach(seed);
afterAll(async () => { await seed(); await app.close(); await queue.stop(); await sqlClient.end(); });

describe("direct status route", () => {
  it("refuses EVERY status for an operator, including reactivating a suspended one", async () => {
    for (const [uid, status] of [[S, "active"], [A, "active"], [A, "suspended"], [A, "locked"], [A, "deactivated"]] as const) {
      const r = await app.inject({ method: "PATCH", url: `/identity/users/${uid}/status`, headers: hdr(P, ["platform_admin"]), payload: { status } });
      expect(r.statusCode, `${uid} -> ${status}`).toBe(409);
      expect(r.json().code).toBe("OPERATOR_REQUIRES_APPROVAL");
    }
    expect((await userRow(S)).status).toBe("suspended");
    expect((await app.inject({ method: "DELETE", url: `/identity/users/${B}`, headers: hdr(P, ["platform_admin"]) })).statusCode).toBe(409);
  });

  it("an ordinary user can still be suspended and reactivated", async () => {
    expect((await app.inject({ method: "PATCH", url: `/identity/users/${PLAIN}/status`, headers: hdr(A, ["super_admin"]), payload: { status: "suspended" } })).statusCode).toBe(202);
    await drain();
    expect((await userRow(PLAIN)).status).toBe("suspended");
    expect((await app.inject({ method: "PATCH", url: `/identity/users/${PLAIN}/status`, headers: hdr(A, ["super_admin"]), payload: { status: "active" } })).statusCode).toBe(202);
    await drain();
    expect((await userRow(PLAIN)).status).toBe("active");
  });

  it("the consumer refuses too when a status command reaches the queue another way", async () => {
    await queue.publish(COMMANDS.deactivateUser, env(COMMANDS.deactivateUser, P, { id: S, status: "active" }));
    await queue.publish(COMMANDS.deactivateUser, env(COMMANDS.deactivateUser, P, { id: B, status: "deactivated" }));
    await drain();
    expect((await userRow(S)).status).toBe("suspended");
    expect((await userRow(B)).status).toBe("active");
    expect((await audits("status_change_refused", B))[0]).toMatchObject({ outcome: "denied", code: "OPERATOR_REQUIRES_APPROVAL" });
  });
});

describe("SCIM", () => {
  const url = (uid: string) => `/v1/identity/scim/Users/${uid}`;

  it("refuses to disable, enable or delete an operator", async () => {
    const off = await app.inject({ method: "PUT", url: url(B), headers: scimHdr, payload: { userName: `${B}@dept.gov.in`, active: false } });
    expect(off.statusCode).toBe(409);
    expect(off.json().code).toBe("OPERATOR_REQUIRES_APPROVAL");
    expect((await app.inject({ method: "PATCH", url: url(B), headers: scimHdr, payload: { Operations: [{ op: "replace", path: "active", value: false }] } })).statusCode).toBe(409);
    // reactivation of a suspended operator
    expect((await app.inject({ method: "PATCH", url: url(S), headers: scimHdr, payload: { Operations: [{ op: "replace", path: "active", value: true }] } })).statusCode).toBe(409);
    expect((await app.inject({ method: "PUT", url: url(S), headers: scimHdr, payload: { userName: `${S}@dept.gov.in`, active: true } })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: url(A), headers: scimHdr })).statusCode).toBe(409);
    await drain();
    expect((await userRow(B)).status).toBe("active");
    expect((await userRow(S)).status).toBe("suspended");
    expect((await userRow(A)).status).toBe("active");
  });

  it("still accepts attribute edits and a no-op active flag for an operator, and any change for an ordinary user", async () => {
    expect((await app.inject({ method: "PATCH", url: url(B), headers: scimHdr, payload: { Operations: [{ op: "replace", path: "active", value: true }, { op: "replace", path: "name.formatted", value: "Bp Bimal Renamed" }] } })).statusCode).toBe(202);
    await drain();
    expect(await userRow(B)).toMatchObject({ status: "active", name: "Bp Bimal Renamed" });
    expect((await app.inject({ method: "DELETE", url: url(PLAIN), headers: scimHdr })).statusCode).toBe(202);
  });

  it("the SCIM consumers re-check: status is dropped (other fields apply) and a delete is skipped", async () => {
    await queue.publish(COMMANDS.scimUserPatch, env(COMMANDS.scimUserPatch, A, { id: B, tenantId: T, patch: { status: "disabled", name: "Bp Bimal Patched" } }));
    await queue.publish(COMMANDS.scimUserReplace, env(COMMANDS.scimUserReplace, A, { id: S, tenantId: T, patch: { status: "active" } }));
    await queue.publish(COMMANDS.scimUserDelete, env(COMMANDS.scimUserDelete, A, { id: A, tenantId: T }));
    await drain();
    expect(await userRow(B)).toMatchObject({ status: "active", name: "Bp Bimal Patched" });
    expect((await userRow(S)).status).toBe("suspended");
    expect((await userRow(A)).status).toBe("active");
    expect((await audits("scim_delete_refused", A))[0]).toMatchObject({ outcome: "denied", code: "OPERATOR_REQUIRES_APPROVAL" });
    expect((await audits("scim_status_refused", B))).toHaveLength(1);
  });
});

describe("RBAC role assignment", () => {
  const assign = (roleId: string, userId: string, headers: Record<string, string>) =>
    app.inject({ method: "POST", url: `/identity/rbac/roles/${roleId}/assignments`, headers, payload: { userId } });

  it("refuses self-promotion, promoting an operator and making a new operator directly", async () => {
    const self = await assign(ROLE_SUPER, P, hdr(P, ["platform_admin"]));
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("SELF_ACTION");
    const other = await assign(ROLE_SUPER, B, hdr(P, ["platform_admin"]));
    expect(other.json().code).toBe("OPERATOR_REQUIRES_APPROVAL");
    const fresh = await assign(ROLE_PLAT, PLAIN, hdr(A, ["super_admin"]));
    expect(fresh.statusCode).toBe(409);
    expect(fresh.json().code).toBe("OPERATOR_REQUIRES_APPROVAL");
    await drain();
    expect(await roleKeys(P)).toEqual(["platform_admin"]);
    expect(await roleKeys(PLAIN)).toEqual([]);
  });

  it("refuses to revoke a platform role directly, even from a suspended operator", async () => {
    for (const [roleId, uid] of [[ROLE_SUPER, B], [ROLE_PLAT, S]] as const) {
      const r = await app.inject({ method: "DELETE", url: `/identity/rbac/roles/${roleId}/assignments/${uid}`, headers: hdr(A, ["super_admin"]) });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe("OPERATOR_REQUIRES_APPROVAL");
    }
    expect(await roleKeys(B)).toEqual(["super_admin"]);
  });

  it("the RBAC consumer refuses platform-role assign and revoke commands published another way", async () => {
    await queue.publish(COMMANDS.rbacAssignRole, env(COMMANDS.rbacAssignRole, P, { roleId: ROLE_SUPER, userId: P, callerRoles: ["platform_admin"] }));
    await queue.publish(COMMANDS.rbacRevokeRole, env(COMMANDS.rbacRevokeRole, A, { roleId: ROLE_SUPER, userId: B }));
    await drain();
    expect(await roleKeys(P)).toEqual(["platform_admin"]);
    expect(await roleKeys(B)).toEqual(["super_admin"]);
    expect((await audits("assign", P))[0]).toMatchObject({ outcome: "denied" });
    expect((await audits("revoke", B))[0]).toMatchObject({ outcome: "denied" });
  });
});

describe("creating a new operator: a grant request", () => {
  const request = (target: string, headers: Record<string, string>, body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/identity/operators/${target}/requests`, headers, payload: body });

  it("needs a second super admin: pending first, the role only after approval, audited", async () => {
    const r = await request(PLAIN, hdr(P, ["platform_admin"]), { kind: "grant", reason: "joins the platform team", toRole: "platform_admin" });
    expect(r.statusCode).toBe(202);
    await drain();
    expect(await roleKeys(PLAIN)).toEqual([]);
    const rid = r.json().id as string;
    expect(await asTenant(async (q) => (await q`SELECT 1 FROM users.operator_change_requests WHERE id = ${rid}`).length)).toBe(1);
    // the maker cannot approve; a super admin can
    const own = await app.inject({ method: "POST", url: `/identity/operators/requests/${rid}/approve`, headers: hdr(P, ["super_admin"]), payload: {} });
    expect(own.statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/identity/operators/requests/${rid}/approve`, headers: hdr(A, ["super_admin"]), payload: {} })).statusCode).toBe(202);
    await drain();
    expect(await roleKeys(PLAIN)).toEqual(["platform_admin"]);
    expect((await audits("grant", PLAIN))[0]).toMatchObject({ resourceType: "platform_operator", toRole: "platform_admin", requestedBy: P });
    const op = await app.inject({ method: "GET", url: "/identity/operators", headers: hdr(A, ["super_admin"]) });
    expect(op.json().data.map((o: { id: string }) => o.id)).toContain(PLAIN);
  });

  it("refuses to grant yourself a role, grant to an existing operator, grant to a suspended user, or omit the role", async () => {
    expect((await request(P, hdr(P, ["platform_admin"]), { kind: "grant", reason: "self promote", toRole: "super_admin" })).json().code).toBe("SELF_ACTION");
    expect((await request(B, hdr(P, ["platform_admin"]), { kind: "grant", reason: "already one", toRole: "platform_admin" })).json().code).toBe("INVALID_STATE");
    await asTenant(async (q) => { await q`UPDATE users.users SET status = 'suspended' WHERE id = ${PLAIN}`; });
    expect((await request(PLAIN, hdr(A, ["super_admin"]), { kind: "grant", reason: "suspended user", toRole: "platform_admin" })).json().code).toBe("INVALID_STATE");
    expect((await request(PLAIN, hdr(A, ["super_admin"]), { kind: "grant", reason: "no role given" })).statusCode).toBe(400);
  });
});
