/**
 * GET /identity/security/summary — the counts behind admin-service's Security Center overview — and the
 * audit event the MFA-failure consumer now emits (the source of "failed logins (24h)").
 * Real Postgres, FORCE RLS, non-superuser role.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { createQueue } from "@civitasone/queue";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerMfaConsumers } from "../src/modules/mfa/consumer.js";
import { mfaAdoptionPercent } from "../src/modules/security-summary/routes.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T_A = randomUUID();
const T_B = randomUUID();
const T_EMPTY = randomUUID();
const ACTOR = randomUUID();
const hdr = (tenant: string, roles: string[]) =>
  ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "sess-sec-sum" }, SECRET, 3600)}` });

let app: FastifyInstance;

async function asTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}

async function user(tenant: string, status: string, mfa: boolean) {
  const id = randomUUID();
  await asTenant(tenant, (sql) => sql`
    INSERT INTO users.users (id, tenant_id, email, name, status, mfa_enabled, created_by, updated_by)
    VALUES (${id}, ${tenant}, ${`${id}@nic.in`}, 'U', ${status}, ${mfa}, ${ACTOR}, ${ACTOR})`);
  return id;
}
async function session(tenant: string, userId: string, status: string, expiresInMs: number) {
  await asTenant(tenant, (sql) => sql`
    INSERT INTO sessions.sessions (id, tenant_id, user_id, ip, status, expires_at, created_by, updated_by)
    VALUES (${randomUUID()}, ${tenant}, ${userId}, '10.0.0.1', ${status}, ${new Date(Date.now() + expiresInMs).toISOString()}::timestamptz, ${ACTOR}, ${ACTOR})`);
}
async function device(tenant: string, userId: string, trust: string) {
  await asTenant(tenant, (sql) => sql`
    INSERT INTO devices.registered_devices (id, tenant_id, user_id, platform, label, fingerprint, trust_token_hash, trust_level, created_by, updated_by)
    VALUES (${randomUUID()}, ${tenant}, ${userId}, 'android', 'phone', ${randomUUID()}, encode(sha256(convert_to(${randomUUID()}, 'UTF8')), 'hex'), ${trust}, ${ACTOR}, ${ACTOR})`);
}

beforeAll(async () => {
  app = await buildApp();
  // Tenant A: 4 active users (3 with MFA) + 1 suspended user with MFA (must not count), sessions and devices.
  const u1 = await user(T_A, "active", true);
  await user(T_A, "active", true);
  await user(T_A, "active", true);
  await user(T_A, "active", false);
  await user(T_A, "suspended", true);
  await session(T_A, u1, "active", 3_600_000);   // counts
  await session(T_A, u1, "active", 3_600_000);   // counts
  await session(T_A, u1, "active", -60_000);     // expired
  await session(T_A, u1, "revoked", 3_600_000);  // revoked
  await device(T_A, u1, "recognized");           // counts
  await device(T_A, u1, "trusted");              // counts
  await device(T_A, u1, "revoked");
  await device(T_A, u1, "blocked");
  // Tenant B: one of everything, to prove it never leaks into A.
  const b1 = await user(T_B, "active", true);
  await session(T_B, b1, "active", 3_600_000);
  await device(T_B, b1, "recognized");
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const get = (tenant: string, roles: string[]) =>
  app.inject({ method: "GET", url: "/identity/security/summary", headers: hdr(tenant, roles) });

describe("GET /identity/security/summary", () => {
  it("401 without a token", async () => {
    expect((await app.inject({ method: "GET", url: "/identity/security/summary" })).statusCode).toBe(401);
  });

  it.each([["employee"], ["hr_admin"], ["audit_officer"]])("403 for %s", async (role) => {
    expect((await get(T_A, [role])).statusCode).toBe(403);
  });

  it.each([["tenant_admin"], ["platform_admin"], ["super_admin"]])("200 for %s", async (role) => {
    expect((await get(T_A, [role])).statusCode).toBe(200);
  });

  it("counts only this tenant's live sessions, non-revoked devices, and active users' MFA", async () => {
    const body = (await get(T_A, ["tenant_admin"])).json();
    expect(body).toMatchObject({
      activeSessions: 2, trustedDevices: 2, activeUsers: 4, mfaEnabledUsers: 3, mfaAdoptionRate: 75,
    });
    expect(typeof body.asOf).toBe("string");
  });

  it("tenant isolation: B sees only its own rows", async () => {
    expect((await get(T_B, ["tenant_admin"])).json()).toMatchObject({
      activeSessions: 1, trustedDevices: 1, activeUsers: 1, mfaEnabledUsers: 1, mfaAdoptionRate: 100,
    });
  });

  it("an empty tenant is all zeros (adoption 0, not NaN)", async () => {
    expect((await get(T_EMPTY, ["tenant_admin"])).json()).toMatchObject({
      activeSessions: 0, trustedDevices: 0, activeUsers: 0, mfaEnabledUsers: 0, mfaAdoptionRate: 0,
    });
  });

  it("mfaAdoptionPercent rounds and clamps", () => {
    expect(mfaAdoptionPercent(0, 0)).toBe(0);
    expect(mfaAdoptionPercent(3, 1)).toBe(33);
    expect(mfaAdoptionPercent(3, 2)).toBe(67);
    expect(mfaAdoptionPercent(2, 5)).toBe(100);
  });
});

describe("MFA verify-failure consumer audits the failure", () => {
  it("emits an audit.event.record with outcome=failure and no code or secret", async () => {
    const q = createQueue();
    registerMfaConsumers(tenantScoped(q));
    await q.start();
    const userId = randomUUID();
    await asTenant(T_A, (sql) => sql`
      INSERT INTO mfa.configs (id, tenant_id, user_id, method, secret, enabled, created_by, updated_by)
      VALUES (${randomUUID()}, ${T_A}, ${userId}, 'totp', 'sealed', true, ${ACTOR}, ${ACTOR})`);
    await q.publish(COMMANDS.mfaVerifyFail, {
      messageId: randomUUID(), type: COMMANDS.mfaVerifyFail, tenantId: T_A, actorId: userId, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { userId, tenantId: T_A, nextFailed: 2, lock: false, lockUntilMs: 900000, currentVersion: 1 },
    });
    const end = Date.now() + 4000;
    let found: Record<string, unknown> | undefined;
    while (!found && Date.now() < end) {
      const rows = await asTenant(T_A, (sql) => sql<Array<{ payload: unknown }>>`
        SELECT payload FROM _outbox.messages WHERE tenant_id = ${T_A} AND topic = 'audit.event.record'`);
      found = rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>)
        .find((p) => p.action === "mfa_verify_failed" && p.resourceId === userId);
      if (!found) await new Promise((r) => setTimeout(r, 50));
    }
    expect(found).toMatchObject({ service: "identity", action: "mfa_verify_failed", resourceType: "user", outcome: "failure", locked: false });
    expect(JSON.stringify(found)).not.toMatch(/code|secret/i);
    const cfg = await asTenant(T_A, (sql) => sql<Array<{ failed_attempts: number }>>`SELECT failed_attempts FROM mfa.configs WHERE user_id = ${userId}`);
    expect(cfg[0]!.failed_attempts).toBe(2);
  });
});
