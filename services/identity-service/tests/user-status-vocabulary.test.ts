/**
 * One users.users.status vocabulary: active | suspended | locked | deactivated (users_status_check).
 * Regression: the SCIM consumer used to write status = disabled, which the CHECK rejects, so a SCIM
 * disable (PATCH/PUT active=false) or DELETE of an ordinary user failed at the database. Real Postgres as
 * the non-superuser app role, real Fastify, real consumers.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerUserConsumers } from "../src/modules/users/consumer.js";
import { registerScimConsumers } from "../src/modules/scim/consumer.js";
import { USER_STATUSES } from "../src/modules/users/domain.js";
import { COMMANDS } from "../src/topics.js";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = process.env.SCIM_TENANT_ID as string;
const LEGACY_TOKEN = process.env.SCIM_BEARER_TOKEN as string;
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET as string;
const id = (n: number) => `${T.slice(0, 24)}${String(950 + n).padStart(12, "0")}`;
const ADMIN = id(1), U1 = id(2), U2 = id(3), U3 = id(4), U4 = id(5);
const ALL = [ADMIN, U1, U2, U3, U4];

let app: FastifyInstance;
const drain = () => (queue as unknown as { drain?: () => Promise<void> }).drain?.();
const hdr = { authorization: `Bearer ${signToken({ sub: ADMIN, tid: T, roles: ["super_admin"], sid: "sess-vocab" }, SECRET, 3600)}` };
const scimHdr = { "x-internal": "1", "x-service-secret": INTERNAL_SECRET, "x-tenant-id": T, authorization: `Bearer ${LEGACY_TOKEN}` };

async function asTenant<R>(fn: (q: typeof sqlClient) => Promise<R>): Promise<R> {
  return (await sqlClient.begin(async (q) => {
    await q`SELECT set_config('app.tenant_id', ${T}, true)`;
    return fn(q as unknown as typeof sqlClient);
  })) as R;
}
async function seed() {
  // Scoped to this file's users: other suites share the SCIM tenant and run in parallel, so never wipe the whole tenant outbox.
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${T} AND payload::text LIKE ${'%' + T.slice(0, 24) + '00000000095%'}`;
  await asTenant(async (q) => {
    await q`DELETE FROM identity_kc_reconciliations WHERE user_id IN (${ADMIN}, ${U1}, ${U2}, ${U3}, ${U4})`;
    await q`DELETE FROM users.users WHERE id IN (${ADMIN}, ${U1}, ${U2}, ${U3}, ${U4})`;
    for (const uid of ALL) {
      await q`INSERT INTO users.users (id, tenant_id, email, name, status, created_by, updated_by) VALUES (${uid}, ${T}, ${uid + "@dept.gov.in"}, ${"Vocab " + uid.slice(-3)}, 'active', ${ADMIN}, ${ADMIN})`;
    }
  });
}
const status = (uid: string) => asTenant(async (q) => (await q<Array<{ status: string }>>`SELECT status FROM users.users WHERE id = ${uid}`)[0]!.status);
const url = (uid: string) => `/v1/identity/scim/Users/${uid}`;

beforeAll(async () => {
  registerUserConsumers(queue); registerScimConsumers(queue);
  await queue.start();
  app = await buildApp();
});
beforeEach(seed);
afterAll(async () => { await seed(); await app.close(); await queue.stop(); await sqlClient.end(); });

describe("SCIM disable maps to deactivated", () => {
  it("PATCH active=false deactivates an ordinary user", async () => {
    const r = await app.inject({ method: "PATCH", url: url(U1), headers: scimHdr, payload: { Operations: [{ op: "replace", path: "active", value: false }] } });
    expect(r.statusCode).toBe(202);
    expect(r.json().active).toBe(false);
    await drain();
    expect(await status(U1)).toBe("deactivated");
  });

  it("PUT active=false deactivates an ordinary user", async () => {
    const r = await app.inject({ method: "PUT", url: url(U2), headers: scimHdr, payload: { userName: `${U2}@dept.gov.in`, active: false } });
    expect(r.statusCode).toBe(202);
    await drain();
    expect(await status(U2)).toBe("deactivated");
  });

  it("DELETE deactivates an ordinary user and emits the deactivated event", async () => {
    expect((await app.inject({ method: "DELETE", url: url(U3), headers: scimHdr })).statusCode).toBe(202);
    await drain();
    expect(await status(U3)).toBe("deactivated");
    const ev = await sqlClient<Array<{ payload: unknown }>>`SELECT payload FROM _outbox.messages WHERE tenant_id = ${T} AND topic = 'identity.user.deactivated'`;
    const parsed = ev.map((e) => (typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload) as { userId: string; status: string });
    expect(parsed.find((p) => p.userId === U3)?.status).toBe("deactivated");
  });
});

describe("status route", () => {
  it("lock and suspend both persist for an ordinary user", async () => {
    for (const [uid, next] of [[U1, "locked"], [U2, "suspended"]] as const) {
      const r = await app.inject({ method: "PATCH", url: `/identity/users/${uid}/status`, headers: hdr, payload: { status: next } });
      expect(r.statusCode).toBe(202);
      await drain();
      expect(await status(uid)).toBe(next);
    }
  });

  it("rejects a status outside the vocabulary at the zod boundary", async () => {
    const r = await app.inject({ method: "PATCH", url: `/identity/users/${U1}/status`, headers: hdr, payload: { status: "disabled" } });
    expect(r.statusCode).toBe(400);
    expect(await status(U1)).toBe("active");
  });
});

describe("users_status_check", () => {
  it("accepts every vocabulary value", async () => {
    for (const s of USER_STATUSES) {
      await asTenant(async (q) => { await q`UPDATE users.users SET status = ${s} WHERE id = ${U4}`; });
      expect(await status(U4)).toBe(s);
    }
  });

  it.each(["disabled", "banned", "", "ACTIVE"])("still rejects garbage value %j", async (bad) => {
    await expect(asTenant(async (q) => { await q`UPDATE users.users SET status = ${bad} WHERE id = ${U4}`; })).rejects.toMatchObject({ code: "23514" });
    expect(await status(U4)).toBe("active");
  });
});

// ── Keycloak deprovision + terminal deactivated ─────────────────────────────
const kcCalls: Array<{ method: string; url: string; body?: string }> = [];
let kcDisableStatus = 204;
const kcFetch = async (input: unknown, init?: { method?: string; body?: unknown }): Promise<Response> => {
  const url = String(input);
  const method = init?.method ?? "GET";
  kcCalls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });
  if (url.includes("/protocol/openid-connect/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 300 }), { status: 200 });
  if (url.includes("/users?username=")) {
    const username = decodeURIComponent(url.split("username=")[1]!.split("&")[0]!);
    return new Response(JSON.stringify([{ id: "kc-" + username.slice(-12), enabled: true, username }]), { status: 200 });
  }
  if (method === "PUT") return new Response(null, { status: kcDisableStatus });
  return new Response(null, { status: 204 });
};
const kcEnv = { KEYCLOAK_URL: "http://kc.test", KEYCLOAK_ADMIN_USER: "kcadmin", KEYCLOAK_ADMIN_PASSWORD: "kc-admin-test-pw" };
const savedEnv: Record<string, string | undefined> = {};
const kcRow = (uid: string) => asTenant(async (q) => (await q<Array<{ status: string }>>`SELECT status FROM identity_kc_reconciliations WHERE user_id = ${uid} AND action = 'deactivate'`)[0]?.status);

describe("SCIM deactivation deprovisions Keycloak", () => {
  beforeEach(() => {
    kcCalls.length = 0; kcDisableStatus = 204;
    for (const [k, v] of Object.entries(kcEnv)) { savedEnv[k] = process.env[k]; process.env[k] = v; }
    vi.spyOn(globalThis, "fetch").mockImplementation(kcFetch as typeof fetch);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const k of Object.keys(kcEnv)) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  });
  const disableAndLogout = (uid: string) => {
    const kcId = "kc-" + `${T}__${uid}@dept.gov.in`.slice(-12);
    return {
      disable: kcCalls.filter((c) => c.method === "PUT" && c.url.endsWith(`/users/${kcId}`) && c.body === JSON.stringify({ enabled: false })),
      logout: kcCalls.filter((c) => c.method === "POST" && c.url.endsWith(`/users/${kcId}/logout`)),
    };
  };

  it("PATCH active=false disables the realm user, logs out sessions and resolves the reconciliation row", async () => {
    expect((await app.inject({ method: "PATCH", url: url(U1), headers: scimHdr, payload: { Operations: [{ op: "replace", path: "active", value: false }] } })).statusCode).toBe(202);
    await drain();
    const { disable, logout } = disableAndLogout(U1);
    expect(disable).toHaveLength(1);
    expect(logout).toHaveLength(1);
    expect(await status(U1)).toBe("deactivated");
    expect(await kcRow(U1)).toBe("reconciled");
  });

  it("DELETE disables the realm user and logs out sessions; a repeat DELETE does nothing", async () => {
    await app.inject({ method: "DELETE", url: url(U2), headers: scimHdr });
    await drain();
    expect(disableAndLogout(U2).disable).toHaveLength(1);
    expect(disableAndLogout(U2).logout).toHaveLength(1);
    expect(await kcRow(U2)).toBe("reconciled");
    kcCalls.length = 0;
    await app.inject({ method: "DELETE", url: url(U2), headers: scimHdr });
    await drain();
    expect(kcCalls).toHaveLength(0);
  });

  it("a Keycloak failure leaves the reconciliation row pending for the worker retry, and the DB deactivation stands", async () => {
    kcDisableStatus = 500;
    await app.inject({ method: "DELETE", url: url(U3), headers: scimHdr });
    await drain();
    expect(await status(U3)).toBe("deactivated");
    expect(await kcRow(U3)).toBe("pending");
  });
});

describe("deactivated is terminal for SCIM", () => {
  const deactivate = (uid: string) => asTenant(async (q) => { await q`UPDATE users.users SET status = 'deactivated' WHERE id = ${uid}`; });

  it("PATCH and PUT active=true on a deactivated user return 409 mutability and change nothing", async () => {
    await deactivate(U1);
    const patch = await app.inject({ method: "PATCH", url: url(U1), headers: scimHdr, payload: { Operations: [{ op: "replace", path: "active", value: true }] } });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().scimType).toBe("mutability");
    const put = await app.inject({ method: "PUT", url: url(U1), headers: scimHdr, payload: { userName: `${U1}@dept.gov.in`, active: true } });
    expect(put.statusCode).toBe(409);
    await drain();
    expect(await status(U1)).toBe("deactivated");
  });

  it("the consumer refuses too when the command reaches the queue another way, with a denied audit event", async () => {
    await deactivate(U2);
    await queue.publish(COMMANDS.scimUserPatch, { messageId: randomUUID(), type: COMMANDS.scimUserPatch, tenantId: T, actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0", payload: { id: U2, tenantId: T, patch: { status: "active", name: "Renamed Vocab" } } });
    await drain();
    expect(await status(U2)).toBe("deactivated");
    const rows = await sqlClient<Array<{ payload: unknown }>>`SELECT payload FROM _outbox.messages WHERE tenant_id = ${T} AND topic = 'audit.event.record'`;
    const audits = rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>);
    expect(audits.find((a) => a.action === "scim_status_refused" && a.resourceId === U2)).toMatchObject({ outcome: "denied", code: "USER_DEACTIVATED" });
  });

  it("active=true still re-enables a suspended or locked user", async () => {
    await asTenant(async (q) => { await q`UPDATE users.users SET status = 'locked' WHERE id = ${U3}`; });
    expect((await app.inject({ method: "PATCH", url: url(U3), headers: scimHdr, payload: { Operations: [{ op: "replace", path: "active", value: true }] } })).statusCode).toBe(202);
    await drain();
    expect(await status(U3)).toBe("active");
  });
});

// ── last tenant admin guard (#1839) applied to SCIM ─────────────────────────
describe("SCIM refuses to deactivate the last active tenant admin", () => {
  const ROLE = id(40);
  const makeAdmin = async (...uids: string[]) => asTenant(async (q) => {
    await q`DELETE FROM rbac.role_assignments WHERE tenant_id = ${T} AND role_id = ${ROLE}`;
    await q`DELETE FROM rbac.roles WHERE id = ${ROLE}`;
    await q`INSERT INTO rbac.roles (id, tenant_id, key, name, is_system, created_by, updated_by) VALUES (${ROLE}, ${T}, 'tenant_admin', 'Tenant Admin', true, ${ADMIN}, ${ADMIN})`;
    for (const uid of uids) await q`INSERT INTO rbac.role_assignments (tenant_id, role_id, user_id, created_by, updated_by) VALUES (${T}, ${ROLE}, ${uid}, ${ADMIN}, ${ADMIN})`;
  });
  afterEach(() => asTenant(async (q) => {
    await q`DELETE FROM rbac.role_assignments WHERE tenant_id = ${T} AND role_id = ${ROLE}`;
    await q`DELETE FROM rbac.roles WHERE id = ${ROLE}`;
  }));
  const off = { Operations: [{ op: "replace", path: "active", value: false }] };

  it("PATCH active=false and DELETE on the last tenant admin return 409 LAST_TENANT_ADMIN and change nothing", async () => {
    await makeAdmin(U1);
    const patch = await app.inject({ method: "PATCH", url: url(U1), headers: scimHdr, payload: off });
    expect(patch.statusCode).toBe(409);
    expect(patch.json()).toMatchObject({ code: "LAST_TENANT_ADMIN", scimType: "invalidValue" });
    const put = await app.inject({ method: "PUT", url: url(U1), headers: scimHdr, payload: { userName: `${U1}@dept.gov.in`, active: false } });
    expect(put.statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: url(U1), headers: scimHdr })).statusCode).toBe(409);
    await drain();
    expect(await status(U1)).toBe("active");
  });

  it("the consumer re-checks: a command that reaches the queue another way is refused with a denied audit event", async () => {
    await makeAdmin(U1);
    const env = (type: string, payload: Record<string, unknown>) => ({ messageId: randomUUID(), type, tenantId: T, actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0", payload });
    await queue.publish(COMMANDS.scimUserPatch, env(COMMANDS.scimUserPatch, { id: U1, tenantId: T, patch: { status: "deactivated" } }));
    await queue.publish(COMMANDS.scimUserDelete, env(COMMANDS.scimUserDelete, { id: U1, tenantId: T }));
    await drain();
    expect(await status(U1)).toBe("active");
    const rows = await sqlClient<Array<{ payload: unknown }>>`SELECT payload FROM _outbox.messages WHERE tenant_id = ${T} AND topic = 'audit.event.record'`;
    const denied = rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>)
      .filter((a) => a.reason === "LAST_TENANT_ADMIN" && a.resourceId === U1);
    expect(denied).toHaveLength(2);
    expect(denied[0]).toMatchObject({ outcome: "denied", action: "status_change" });
  });

  it("the same requests succeed when another active tenant admin exists", async () => {
    await makeAdmin(U1, U2);
    expect((await app.inject({ method: "PATCH", url: url(U1), headers: scimHdr, payload: off })).statusCode).toBe(202);
    await drain();
    expect(await status(U1)).toBe("deactivated");
    // U1 is no longer active, so U2 is now the last active admin and is protected
    expect((await app.inject({ method: "DELETE", url: url(U2), headers: scimHdr })).statusCode).toBe(409);
    await makeAdmin(U2, U3);
    expect((await app.inject({ method: "DELETE", url: url(U2), headers: scimHdr })).statusCode).toBe(202);
    await drain();
    expect(await status(U2)).toBe("deactivated");
  });
});

// ── refusal audits, concurrency, transition audit, create validation ─────────
const auditsFor = async (resourceId: string) => (await sqlClient<Array<{ payload: unknown }>>`SELECT payload FROM _outbox.messages WHERE tenant_id = ${T} AND topic = 'audit.event.record'`)
  .map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>)
  .filter((a) => a.resourceId === resourceId);

describe("route-level SCIM refusals are audited", () => {
  const ROLE = id(41);
  afterEach(() => asTenant(async (q) => {
    await q`DELETE FROM rbac.role_assignments WHERE tenant_id = ${T} AND role_id = ${ROLE}`;
    await q`DELETE FROM rbac.roles WHERE id = ${ROLE}`;
  }));

  it("USER_DEACTIVATED (PATCH active=true) and LAST_TENANT_ADMIN (DELETE) each write a denied audit event through the outbox", async () => {
    await asTenant(async (q) => {
      await q`UPDATE users.users SET status = 'deactivated' WHERE id = ${U2}`;
      await q`INSERT INTO rbac.roles (id, tenant_id, key, name, is_system, created_by, updated_by) VALUES (${ROLE}, ${T}, 'tenant_admin', 'Tenant Admin', true, ${ADMIN}, ${ADMIN})`;
      await q`INSERT INTO rbac.role_assignments (tenant_id, role_id, user_id, created_by, updated_by) VALUES (${T}, ${ROLE}, ${U1}, ${ADMIN}, ${ADMIN})`;
    });
    expect((await app.inject({ method: "PATCH", url: url(U2), headers: scimHdr, payload: { Operations: [{ op: "replace", path: "active", value: true }] } })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: url(U1), headers: scimHdr })).statusCode).toBe(409);
    await drain();
    expect(await auditsFor(U2)).toEqual(expect.arrayContaining([expect.objectContaining({ action: "scim_status_refused", outcome: "denied", code: "USER_DEACTIVATED" })]));
    expect(await auditsFor(U1)).toEqual(expect.arrayContaining([expect.objectContaining({ action: "scim_status_refused", outcome: "denied", code: "LAST_TENANT_ADMIN" })]));
  });
});

describe("last tenant admin lock is race-safe", () => {
  const ROLE = id(42);
  afterEach(() => asTenant(async (q) => {
    await q`DELETE FROM rbac.role_assignments WHERE tenant_id = ${T} AND role_id = ${ROLE}`;
    await q`DELETE FROM rbac.roles WHERE id = ${ROLE}`;
  }));

  it("two concurrent SCIM deactivations of the last two tenant admins leave exactly one active", async () => {
    await asTenant(async (q) => {
      await q`INSERT INTO rbac.roles (id, tenant_id, key, name, is_system, created_by, updated_by) VALUES (${ROLE}, ${T}, 'tenant_admin', 'Tenant Admin', true, ${ADMIN}, ${ADMIN})`;
      for (const uid of [U1, U2]) await q`INSERT INTO rbac.role_assignments (tenant_id, role_id, user_id, created_by, updated_by) VALUES (${T}, ${ROLE}, ${uid}, ${ADMIN}, ${ADMIN})`;
    });
    const env = (uid: string) => ({ messageId: randomUUID(), type: COMMANDS.scimUserPatch, tenantId: T, actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0", payload: { id: uid, tenantId: T, patch: { status: "deactivated" } } });
    await Promise.all([queue.publish(COMMANDS.scimUserPatch, env(U1)), queue.publish(COMMANDS.scimUserPatch, env(U2))]);
    await drain();
    const after = [await status(U1), await status(U2)];
    expect(after.filter((s) => s === "active")).toHaveLength(1);
    expect(after.filter((s) => s === "deactivated")).toHaveLength(1);
  });
});

describe("status route consumer audits an impossible transition", () => {
  it("deactivated -> active is refused with a denied INVALID_TRANSITION audit instead of a bare throw", async () => {
    await asTenant(async (q) => { await q`UPDATE users.users SET status = 'deactivated' WHERE id = ${U4}`; });
    await queue.publish(COMMANDS.deactivateUser, { messageId: randomUUID(), type: COMMANDS.deactivateUser, tenantId: T, actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0", payload: { id: U4, status: "active" } });
    await drain();
    expect(await status(U4)).toBe("deactivated");
    expect(await auditsFor(U4)).toEqual(expect.arrayContaining([expect.objectContaining({ action: "status_change", outcome: "denied", reason: "INVALID_TRANSITION" })]));
  });
});

describe("SCIM create validates the status", () => {
  it("a create command with a status outside the vocabulary fails before touching the database", async () => {
    const newId = randomUUID();
    await queue.publish(COMMANDS.scimUserCreate, { messageId: randomUUID(), type: COMMANDS.scimUserCreate, tenantId: T, actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0", payload: { id: newId, tenantId: T, email: `${newId}@dept.gov.in`, name: "Bad Status", status: "disabled" } });
    await drain();
    const rows = await asTenant(async (q) => q`SELECT id FROM users.users WHERE id = ${newId}`);
    expect(rows).toHaveLength(0);
  });
});
