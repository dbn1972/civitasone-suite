/**
 * GAP-ADMIN-OPERATORS-05: platform-operator directory and maker-checker management
 * (suspend / reactivate / role change). Real Postgres, real RLS, non-superuser role.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerOperatorConsumers, applyDecision } from "../src/modules/operators/consumer.js";
import {
  PLATFORM_ROLE_KEYS, primaryRoleKey, removesLastSuperAdmin, validateChange,
} from "../src/modules/operators/domain.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "cccccccc-0028-4000-8000-000000000001";
const T_OTHER = "dddddddd-0028-4000-8000-000000000002";
const id = (n: number) => `cccccccc-0028-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const A = id(10), B = id(11), C = id(12), P = id(13), PLAIN = id(14);
const ROLE_SUPER = id(20), ROLE_PLAT = id(21), PERM = id(22);
const OTHER_OP = "dddddddd-0028-4000-8000-0000000000a1";

let app: FastifyInstance;
const drain = () => (queue as unknown as { drain?: () => Promise<void> }).drain?.();

const hdr = (tid: string, sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid, roles, sid: "sess-operators" }, SECRET, 3600)}`,
});
const asSuper = (sub: string) => hdr(T, sub, ["super_admin"]);
const asPlat = (sub: string) => hdr(T, sub, ["platform_admin"]);

/** Raw SQL under the tenant GUC: the service role is NOBYPASSRLS, so un-scoped statements see zero rows. */
async function asTenant<R>(tenantId: string, fn: (q: typeof sqlClient) => Promise<R>): Promise<R> {
  return (await sqlClient.begin(async (q) => {
    await q`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(q as unknown as typeof sqlClient);
  })) as R;
}

async function wipe(tenantId: string) {
  // audit rows from earlier tests / earlier runs must not leak into this test's counts
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${tenantId}`;
  await asTenant(tenantId, async (q) => {
    await q`DELETE FROM users.operator_change_requests WHERE tenant_id = ${tenantId}`;
    await q`DELETE FROM sessions.sessions WHERE tenant_id = ${tenantId}`;
    await q`DELETE FROM rbac.role_assignment_history WHERE tenant_id = ${tenantId}`;
    await q`DELETE FROM rbac.role_assignments WHERE tenant_id = ${tenantId}`;
    await q`DELETE FROM rbac.role_permissions WHERE tenant_id = ${tenantId}`;
    await q`DELETE FROM rbac.permissions WHERE tenant_id = ${tenantId}`;
    await q`DELETE FROM rbac.roles WHERE tenant_id = ${tenantId}`;
    await q`DELETE FROM users.users WHERE tenant_id = ${tenantId}`;
  });
}

/** A: super_admin, B: super_admin, C: super_admin, P: platform_admin, PLAIN: a non-operator user. */
async function seed() {
  await wipe(T);
  await asTenant(T, async (q) => {
    const actor = id(99);
    for (const [uid, name, mfa] of [[A, "Asha Super", true], [B, "Bimal Super", false], [C, "Chitra Super", true], [P, "Pavan Platform", true], [PLAIN, "Plain User", false]] as const) {
      await q`INSERT INTO users.users (id, tenant_id, email, name, status, mfa_enabled, created_by, updated_by)
              VALUES (${uid}, ${T}, ${uid + "@dept.gov.in"}, ${name}, 'active', ${mfa}, ${actor}, ${actor})`;
    }
    await q`INSERT INTO rbac.roles (id, tenant_id, key, name, is_system, created_by, updated_by) VALUES (${ROLE_SUPER}, ${T}, 'super_admin', 'Super Admin', true, ${actor}, ${actor})`;
    await q`INSERT INTO rbac.roles (id, tenant_id, key, name, is_system, created_by, updated_by) VALUES (${ROLE_PLAT}, ${T}, 'platform_admin', 'Platform Admin', true, ${actor}, ${actor})`;
    await q`INSERT INTO rbac.permissions (id, tenant_id, key, name, created_by, updated_by) VALUES (${PERM}, ${T}, 'settings.read', 'Read settings', ${actor}, ${actor})`;
    await q`INSERT INTO rbac.role_permissions (tenant_id, role_id, permission_id, created_by) VALUES (${T}, ${ROLE_SUPER}, ${PERM}, ${actor})`;
    for (const [uid, rid] of [[A, ROLE_SUPER], [B, ROLE_SUPER], [C, ROLE_SUPER], [P, ROLE_PLAT]] as const) {
      await q`INSERT INTO rbac.role_assignments (tenant_id, role_id, user_id, status, created_by, updated_by) VALUES (${T}, ${rid}, ${uid}, 'active', ${actor}, ${actor})`;
    }
    await q`INSERT INTO sessions.sessions (tenant_id, user_id, ip, status, started_at, expires_at, created_by, updated_by)
            VALUES (${T}, ${B}, '10.0.0.1', 'active', now() - interval '1 hour', now() + interval '1 day', ${B}, ${B})`;
  });
}

const userStatus = (uid: string) => asTenant(T, async (q) => (await q<Array<{ status: string }>>`SELECT status FROM users.users WHERE id = ${uid}`)[0]!.status);
const roleKeysOf = (uid: string) => asTenant(T, async (q) =>
  (await q<Array<{ key: string }>>`SELECT r.key FROM rbac.role_assignments ra JOIN rbac.roles r ON r.id = ra.role_id WHERE ra.user_id = ${uid} AND ra.status = 'active' ORDER BY r.key`).map((r) => r.key));
const requestRow = (rid: string) => asTenant(T, async (q) => (await q<Array<Record<string, unknown>>>`SELECT * FROM users.operator_change_requests WHERE id = ${rid}`)[0]);
async function audits(tenantId: string, action: string, resourceId?: string) {
  const rows = await sqlClient<Array<{ payload: unknown }>>`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenantId} AND topic = 'audit.event.record'`;
  return rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>)
    .filter((p) => p.action === action && (resourceId === undefined || p.resourceId === resourceId));
}

async function req(headers: Record<string, string>, target: string, body: Record<string, unknown>) {
  const r = await app.inject({ method: "POST", url: `/identity/operators/${target}/requests`, headers, payload: body });
  if (r.statusCode === 202) await drain();
  return r;
}
async function decide(headers: Record<string, string>, requestId: string, what: "approve" | "reject" | "cancel", body: Record<string, unknown> = {}) {
  const r = await app.inject({ method: "POST", url: `/identity/operators/requests/${requestId}/${what}`, headers, payload: body });
  if (r.statusCode === 202) await drain();
  return r;
}
const reqId = (r: { json: () => { id?: string; data?: { id?: string } } }) => r.json().id ?? r.json().data?.id ?? "";

beforeAll(async () => {
  registerOperatorConsumers(queue);
  await queue.start();
  app = await buildApp();
  await wipe(T_OTHER);
  await asTenant(T_OTHER, async (q) => {
    await q`INSERT INTO users.users (id, tenant_id, email, name, status, created_by, updated_by) VALUES (${OTHER_OP}, ${T_OTHER}, 'x@other.gov.in', 'Other Tenant Operator', 'active', ${OTHER_OP}, ${OTHER_OP})`;
    await q`INSERT INTO rbac.roles (tenant_id, key, name, created_by, updated_by) VALUES (${T_OTHER}, 'super_admin', 'Super Admin', ${OTHER_OP}, ${OTHER_OP})`;
    await q`INSERT INTO rbac.role_assignments (tenant_id, role_id, user_id, created_by, updated_by)
            SELECT ${T_OTHER}, id, ${OTHER_OP}, ${OTHER_OP}, ${OTHER_OP} FROM rbac.roles WHERE tenant_id = ${T_OTHER} AND key = 'super_admin'`;
  });
});
beforeEach(async () => { await seed(); });
afterAll(async () => { await wipe(T); await wipe(T_OTHER); await app.close(); await queue.stop(); await sqlClient.end(); });

describe("domain rules", () => {
  it("only super_admin / platform_admin make an operator; super_admin outranks", () => {
    expect([...PLATFORM_ROLE_KEYS]).toEqual(["super_admin", "platform_admin"]);
    expect(primaryRoleKey(["platform_admin", "super_admin"])).toBe("super_admin");
    expect(primaryRoleKey(["tenant_admin"])).toBeNull();
  });
  it("validates each kind against the operator's state", () => {
    const active = { id: "x", status: "active", roleKeys: ["platform_admin"] };
    const suspended = { id: "x", status: "suspended", roleKeys: ["platform_admin"] };
    expect(validateChange("suspend", active)).toBeNull();
    expect(validateChange("suspend", suspended)).toBe("INVALID_STATE");
    expect(validateChange("reactivate", suspended)).toBeNull();
    expect(validateChange("reactivate", active)).toBe("INVALID_STATE");
    expect(validateChange("role_change", active, "super_admin")).toBeNull();
    expect(validateChange("role_change", active, "platform_admin")).toBe("INVALID_ROLE");
    expect(validateChange("role_change", active, "tenant_admin")).toBe("INVALID_ROLE");
    expect(validateChange("role_change", suspended, "super_admin")).toBe("INVALID_STATE");
    expect(validateChange("suspend", { id: "x", status: "active", roleKeys: [] })).toBe("NOT_AN_OPERATOR");
  });
  it("the last super admin can be neither suspended nor demoted", () => {
    const sup = { id: "x", status: "active", roleKeys: ["super_admin"] };
    expect(removesLastSuperAdmin("suspend", sup, null, 1)).toBe(true);
    expect(removesLastSuperAdmin("role_change", sup, "platform_admin", 1)).toBe(true);
    expect(removesLastSuperAdmin("suspend", sup, null, 2)).toBe(false);
    expect(removesLastSuperAdmin("role_change", sup, "super_admin", 1)).toBe(false);
    expect(removesLastSuperAdmin("suspend", { id: "x", status: "active", roleKeys: ["platform_admin"] }, null, 1)).toBe(false);
  });
});

describe("GET /identity/operators", () => {
  it("is for platform roles only", async () => {
    for (const roles of [["tenant_admin"], ["employee"]]) {
      expect((await app.inject({ method: "GET", url: "/identity/operators", headers: hdr(T, PLAIN, roles) })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/identity/operators/requests", headers: hdr(T, PLAIN, roles) })).statusCode).toBe(403);
    }
  });

  it("lists this tenant's operators only, in a stable order, with status, 2FA, last login and permissions", async () => {
    const res = await app.inject({ method: "GET", url: "/identity/operators", headers: asSuper(A) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.total).toBe(4);
    expect((body.data as Array<{ name: string }>).map((o) => o.name)).toEqual(["Asha Super", "Bimal Super", "Chitra Super", "Pavan Platform"]);
    const asha = body.data[0];
    expect(asha).toMatchObject({ id: A, role: "super_admin", status: "active", twoFaStatus: "enabled", permissions: ["settings.read"], pendingRequest: null });
    expect(body.data[1]).toMatchObject({ name: "Bimal Super", twoFaStatus: "disabled" });
    expect(body.data[1].lastLogin).not.toBe("");
    expect(asha.lastLogin).toBe("");
    // the non-operator and the other tenant's operator never appear
    expect(JSON.stringify(body)).not.toContain("Plain User");
    expect(JSON.stringify(body)).not.toContain("Other Tenant Operator");
  });

  it("pages with a bounded limit and reports the total", async () => {
    const res = await app.inject({ method: "GET", url: "/identity/operators?limit=2&offset=2", headers: asSuper(A) });
    expect(res.json().data.map((o: { name: string }) => o.name)).toEqual(["Chitra Super", "Pavan Platform"]);
    expect(res.json().meta).toMatchObject({ total: 4, pageSize: 2, page: 2 });
    expect((await app.inject({ method: "GET", url: "/identity/operators?limit=1000", headers: asSuper(A) })).statusCode).toBe(400);
  });
});

describe("requesting a change", () => {
  it("needs a reason, a known kind, and a role for a role change", async () => {
    expect((await req(asSuper(A), B, { kind: "suspend" })).statusCode).toBe(400);
    expect((await req(asSuper(A), B, { kind: "suspend", reason: "no" })).statusCode).toBe(400);
    expect((await req(asSuper(A), B, { kind: "delete", reason: "because" })).statusCode).toBe(400);
    expect((await req(asSuper(A), B, { kind: "role_change", reason: "because" })).statusCode).toBe(400);
    expect((await req(asSuper(A), B, { kind: "suspend", reason: "because", toRole: "super_admin" })).statusCode).toBe(400);
  });

  it("refuses to act on yourself, on a non-operator, and an impossible state", async () => {
    const self = await req(asSuper(A), A, { kind: "suspend", reason: "testing self" });
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("SELF_ACTION");
    expect((await req(asSuper(A), PLAIN, { kind: "suspend", reason: "not an operator" })).statusCode).toBe(404);
    expect((await req(asSuper(A), B, { kind: "reactivate", reason: "already active" })).json().code).toBe("INVALID_STATE");
    expect((await req(asSuper(A), P, { kind: "role_change", reason: "same role", toRole: "platform_admin" })).json().code).toBe("INVALID_ROLE");
  });

  it("creates a PENDING request, changes nothing, and audits the request", async () => {
    const r = await req(asPlat(P), B, { kind: "suspend", reason: "left the platform team" });
    expect(r.statusCode).toBe(202);
    const rid = reqId(r);
    const row = await requestRow(rid);
    expect(row).toMatchObject({ status: "pending", kind: "suspend", target_user_id: B, requested_by: P, from_role_key: "super_admin", reason: "left the platform team" });
    expect(await userStatus(B)).toBe("active");
    const a = await audits(T, "request", rid);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "suspend", targetUserId: B, reason: "left the platform team" });
    const list = await app.inject({ method: "GET", url: "/identity/operators", headers: asSuper(A) });
    expect(list.json().data.find((o: { id: string }) => o.id === B).pendingRequest).toMatchObject({ id: rid, kind: "suspend", requestedBy: P });
  });

  it("allows only one pending request per operator", async () => {
    expect((await req(asPlat(P), B, { kind: "suspend", reason: "first request" })).statusCode).toBe(202);
    const second = await req(asSuper(A), B, { kind: "suspend", reason: "second request" });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("ALREADY_PENDING");
  });

  it("refuses to suspend or demote the last active super admin", async () => {
    await asTenant(T, async (q) => { await q`UPDATE users.users SET status = 'suspended' WHERE id IN (${B}, ${C})`; });
    const s = await req(asPlat(P), A, { kind: "suspend", reason: "would lock everyone out" });
    expect(s.statusCode).toBe(409);
    expect(s.json().code).toBe("LAST_SUPER_ADMIN");
    const d = await req(asPlat(P), A, { kind: "role_change", reason: "would lock everyone out", toRole: "platform_admin" });
    expect(d.json().code).toBe("LAST_SUPER_ADMIN");
    // a platform_admin is not a super admin, so suspending one is fine
    expect((await req(asSuper(A), P, { kind: "suspend", reason: "platform admin may be suspended" })).statusCode).toBe(202);
  });

  it("a request published straight to the queue is re-checked by the consumer (self action, not an operator)", async () => {
    const rid = randomUUID();
    await queue.publish(COMMANDS.operatorRequest, {
      messageId: randomUUID(), type: COMMANDS.operatorRequest, tenantId: T, actorId: A, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: rid, targetUserId: A, kind: "suspend", reason: "published directly" },
    });
    await queue.publish(COMMANDS.operatorRequest, {
      messageId: randomUUID(), type: COMMANDS.operatorRequest, tenantId: T, actorId: PLAIN, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), targetUserId: B, kind: "suspend", reason: "a non-operator asking" },
    });
    await drain();
    expect(await requestRow(rid)).toBeUndefined();
    expect((await audits(T, "request_refused")).map((a) => a.code).sort()).toEqual(["NOT_AN_OPERATOR", "SELF_ACTION"]);
  });
});

describe("deciding", () => {
  it("only a super_admin can approve or reject", async () => {
    const rid = reqId(await req(asSuper(A), B, { kind: "suspend", reason: "needs a decision" }));
    expect((await decide(asPlat(P), rid, "approve")).statusCode).toBe(403);
    expect((await decide(hdr(T, PLAIN, ["tenant_admin"]), rid, "reject", { note: "nope" })).statusCode).toBe(403);
    expect((await requestRow(rid))!.status).toBe("pending");
  });

  it("maker != checker: the requester cannot approve or reject their own request", async () => {
    const rid = reqId(await req(asSuper(A), B, { kind: "suspend", reason: "needs a different approver" }));
    const r = await decide(asSuper(A), rid, "approve");
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("SELF_ACTION");
    expect((await decide(asSuper(A), rid, "reject", { note: "reject my own" })).statusCode).toBe(409);
    expect((await requestRow(rid))!.status).toBe("pending");
    expect(await userStatus(B)).toBe("active");
  });

  it("maker != checker also holds in the consumer and in the database", async () => {
    const rid = reqId(await req(asSuper(A), B, { kind: "suspend", reason: "published decision by the maker" }));
    await queue.publish(COMMANDS.operatorDecide, {
      messageId: randomUUID(), type: COMMANDS.operatorDecide, tenantId: T, actorId: A, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { requestId: rid, decision: "approve" },
    });
    await drain();
    expect((await requestRow(rid))!.status).toBe("pending");
    expect(await userStatus(B)).toBe("active");
    expect((await audits(T, "approve_refused", rid))[0]).toMatchObject({ code: "SELF_ACTION", outcome: "denied" });
    await expect(asTenant(T, async (q) => { await q`UPDATE users.operator_change_requests SET status = 'approved', decided_by = requested_by WHERE id = ${rid}`; })).rejects.toThrow(/maker_checker/);
  });

  it("approving a suspension suspends the operator, ends their sessions, audits both steps", async () => {
    const rid = reqId(await req(asPlat(P), B, { kind: "suspend", reason: "left the platform team" }));
    expect((await decide(asSuper(A), rid, "approve", { note: "confirmed with HR" })).statusCode).toBe(202);
    expect(await userStatus(B)).toBe("suspended");
    expect(await requestRow(rid)).toMatchObject({ status: "approved", decided_by: A, decision_note: "confirmed with HR", kc_sync: "skipped" });
    const live = await asTenant(T, async (q) => (await q`SELECT 1 FROM sessions.sessions WHERE user_id = ${B} AND status = 'active'`).length);
    expect(live).toBe(0);
    expect(await audits(T, "approve", rid)).toHaveLength(1);
    const effect = await audits(T, "suspend", B);
    expect(effect).toHaveLength(1);
    expect(effect[0]).toMatchObject({ resourceType: "platform_operator", requestId: rid, requestedBy: P, reason: "left the platform team", sessionsRevoked: 1 });
    // the directory shows the new state and no pending request
    const list = await app.inject({ method: "GET", url: "/identity/operators", headers: asSuper(A) });
    expect(list.json().data.find((o: { id: string }) => o.id === B)).toMatchObject({ status: "suspended", pendingRequest: null });
  });

  it("reactivates a suspended operator after approval", async () => {
    await asTenant(T, async (q) => { await q`UPDATE users.users SET status = 'suspended' WHERE id = ${P}`; });
    const rid = reqId(await req(asSuper(A), P, { kind: "reactivate", reason: "back from leave" }));
    expect(await userStatus(P)).toBe("suspended");
    await decide(asSuper(B), rid, "approve");
    expect(await userStatus(P)).toBe("active");
    expect((await audits(T, "reactivate", P))).toHaveLength(1);
  });

  it("changes the role after approval: old platform role revoked, new one active, history kept", async () => {
    const rid = reqId(await req(asSuper(A), P, { kind: "role_change", reason: "promoted", toRole: "super_admin" }));
    expect(await roleKeysOf(P)).toEqual(["platform_admin"]);
    await decide(asSuper(B), rid, "approve");
    expect(await roleKeysOf(P)).toEqual(["super_admin"]);
    const hist = await asTenant(T, async (q) => (await q<Array<{ action: string }>>`SELECT action FROM rbac.role_assignment_history WHERE user_id = ${P} ORDER BY recorded_at`).map((h) => h.action));
    expect(hist).toEqual(["revoke", "assign"]);
    expect((await audits(T, "role_change", P))[0]).toMatchObject({ fromRole: "platform_admin", toRole: "super_admin" });
    // and back: demoting a super admin is allowed while others remain
    const back = reqId(await req(asSuper(A), P, { kind: "role_change", reason: "demoted again", toRole: "platform_admin" }));
    await decide(asSuper(B), back, "approve");
    expect(await roleKeysOf(P)).toEqual(["platform_admin"]);
  });

  it("a rejection records the note and changes nothing", async () => {
    const rid = reqId(await req(asPlat(P), B, { kind: "suspend", reason: "wrong person?" }));
    expect((await decide(asSuper(A), rid, "reject", {})).statusCode).toBe(400);
    expect((await decide(asSuper(A), rid, "reject", { note: "not approved" })).statusCode).toBe(202);
    expect(await requestRow(rid)).toMatchObject({ status: "rejected", decided_by: A, decision_note: "not approved" });
    expect(await userStatus(B)).toBe("active");
    expect(await audits(T, "reject", rid)).toHaveLength(1);
    // a rejected request is closed: the operator can be asked about again
    expect((await req(asPlat(P), B, { kind: "suspend", reason: "second try" })).statusCode).toBe(202);
  });

  it("only the maker can cancel, and only while pending", async () => {
    const rid = reqId(await req(asPlat(P), B, { kind: "suspend", reason: "changed my mind" }));
    expect((await decide(asSuper(A), rid, "cancel")).statusCode).toBe(403);
    expect((await decide(asPlat(P), rid, "cancel")).statusCode).toBe(202);
    expect((await requestRow(rid))!.status).toBe("cancelled");
    expect((await decide(asPlat(P), rid, "cancel")).statusCode).toBe(409);
    expect((await decide(asSuper(A), rid, "approve")).statusCode).toBe(409);
    expect(await audits(T, "cancel", rid)).toHaveLength(1);
  });

  it("a decision for a request that is gone or already decided is a no-op", async () => {
    expect((await decide(asSuper(A), randomUUID(), "approve")).statusCode).toBe(404);
    const rid = reqId(await req(asPlat(P), B, { kind: "suspend", reason: "decide twice" }));
    await decide(asSuper(A), rid, "approve");
    const again = await decide(asSuper(C), rid, "approve");
    expect(again.statusCode).toBe(409);
    expect(await audits(T, "approve", rid)).toHaveLength(1);
  });

  it("re-checks the last-super-admin rule inside the approving transaction and refuses", async () => {
    // Legitimate while two super admins remain...
    const rid = reqId(await req(asPlat(P), A, { kind: "suspend", reason: "rotate the owner account" }));
    // ...then the world changes before approval: B and C are suspended directly.
    await asTenant(T, async (q) => { await q`UPDATE users.users SET status = 'suspended' WHERE id IN (${B}, ${C})`; });
    // A can no longer be approved by anyone but another active super admin; use the consumer directly with A as approver of a
    // request made by P against A's own role -- A is the only super admin and the decider, so both guards apply.
    await queue.publish(COMMANDS.operatorDecide, {
      messageId: randomUUID(), type: COMMANDS.operatorDecide, tenantId: T, actorId: A, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { requestId: rid, decision: "approve" },
    });
    await drain();
    expect(await userStatus(A)).toBe("active");
    expect(await requestRow(rid)).toMatchObject({ status: "refused", refusal_reason: expect.stringContaining("last active super admin") });
    expect((await audits(T, "approve_refused", rid))[0]).toMatchObject({ code: "LAST_SUPER_ADMIN", outcome: "denied" });
  });

  it("an approver who is no longer an active super admin cannot decide", async () => {
    const rid = reqId(await req(asPlat(P), C, { kind: "suspend", reason: "approver goes inactive" }));
    await asTenant(T, async (q) => { await q`UPDATE users.users SET status = 'suspended' WHERE id = ${A}`; });
    await decide(asSuper(A), rid, "approve");
    expect((await requestRow(rid))!.status).toBe("pending");
    expect(await userStatus(C)).toBe("active");
    expect((await audits(T, "approve_refused", rid))[0]).toMatchObject({ code: "NOT_AN_OPERATOR" });
  });

  it("a redelivered decision is applied once", async () => {
    const rid = reqId(await req(asPlat(P), B, { kind: "suspend", reason: "redelivery" }));
    const env = { messageId: randomUUID(), type: COMMANDS.operatorDecide, tenantId: T, actorId: A, correlationId: randomUUID(), schemaVersion: "1.0", payload: { requestId: rid, decision: "approve" } };
    await queue.publish(COMMANDS.operatorDecide, env);
    await queue.publish(COMMANDS.operatorDecide, env);
    await drain();
    expect(await audits(T, "approve", rid)).toHaveLength(1);
    expect(await userStatus(B)).toBe("suspended");
  });
});

describe("races", () => {
  it("two approvals that would remove the last two super admins: exactly one lands, one super admin remains", async () => {
    await asTenant(T, async (q) => { await q`UPDATE users.users SET status = 'suspended' WHERE id = ${C}`; await q`DELETE FROM rbac.role_assignments WHERE user_id = ${C}`; });
    // two active super admins (A, B). One request suspends B, the other demotes A.
    const r1 = reqId(await req(asPlat(P), B, { kind: "suspend", reason: "race one: suspend B" }));
    const r2 = reqId(await req(asPlat(P), A, { kind: "role_change", reason: "race two: demote A", toRole: "platform_admin" }));
    const run = (decider: string, requestId: string) => runWithTenant(T, () => db.transaction((tx) =>
      applyDecision(tx as never, tx, {
        messageId: randomUUID(), type: COMMANDS.operatorDecide, tenantId: T, actorId: decider, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { requestId, decision: "approve" },
      } as never)));
    await Promise.all([run(A, r1), run(B, r2)]);
    const supers = await asTenant(T, async (q) => (await q`
      SELECT 1 FROM rbac.role_assignments ra JOIN rbac.roles r ON r.id = ra.role_id JOIN users.users u ON u.id = ra.user_id
      WHERE ra.status = 'active' AND r.key = 'super_admin' AND u.status = 'active'`).length);
    expect(supers).toBe(1);
    const statuses = [(await requestRow(r1))!.status, (await requestRow(r2))!.status].sort();
    expect(statuses).toEqual(["approved", "pending"]);
  });

  it("two concurrent decisions on one request: one wins", async () => {
    const rid = reqId(await req(asPlat(P), B, { kind: "suspend", reason: "double approve" }));
    const run = (decider: string) => runWithTenant(T, () => db.transaction((tx) =>
      applyDecision(tx as never, tx, {
        messageId: randomUUID(), type: COMMANDS.operatorDecide, tenantId: T, actorId: decider, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { requestId: rid, decision: "approve" },
      } as never)));
    await Promise.all([run(A), run(C)]);
    expect(await audits(T, "approve", rid)).toHaveLength(1);
    expect(await userStatus(B)).toBe("suspended");
  });
});

describe("direct routes cannot bypass the approval", () => {
  it("the user status route refuses to suspend an operator but still works for ordinary users", async () => {
    const op = await app.inject({ method: "PATCH", url: `/identity/users/${B}/status`, headers: asSuper(A), payload: { status: "suspended" } });
    expect(op.statusCode).toBe(409);
    expect(op.json().code).toBe("OPERATOR_REQUIRES_APPROVAL");
    expect(await userStatus(B)).toBe("active");
    const plain = await app.inject({ method: "PATCH", url: `/identity/users/${PLAIN}/status`, headers: asSuper(A), payload: { status: "suspended" } });
    expect(plain.statusCode).toBe(202);
  });

  it("revoking a platform role through the RBAC route is refused for an operator", async () => {
    const r = await app.inject({ method: "DELETE", url: `/identity/rbac/roles/${ROLE_SUPER}/assignments/${B}`, headers: asSuper(A) });
    expect([409]).toContain(r.statusCode);
    expect(await roleKeysOf(B)).toEqual(["super_admin"]);
  });
});

describe("tenant isolation", () => {
  it("another tenant's super admin cannot see or decide this tenant's requests", async () => {
    const rid = reqId(await req(asPlat(P), B, { kind: "suspend", reason: "isolation check" }));
    const foreign = hdr(T_OTHER, OTHER_OP, ["super_admin"]);
    expect(((await app.inject({ method: "GET", url: "/identity/operators/requests", headers: foreign })).json().data as unknown[]).length).toBe(0);
    expect((await decide(foreign, rid, "approve")).statusCode).toBe(404);
    expect((await requestRow(rid))!.status).toBe("pending");
  });
});
