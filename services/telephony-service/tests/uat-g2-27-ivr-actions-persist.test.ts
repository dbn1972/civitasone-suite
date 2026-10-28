/**
 * UAT G2 #27 (IVR actions persist) + observation (ivr-hits for an unknown call -> 404).
 * DB-backed: routes publish commands, the real consumers write Postgres.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { registerConsumersOnce, drainQueue, seedCall } from "./consumer-harness.js";

// JWT_SECRET is provided by vitest.config.ts (test env).
const SECRET = process.env.JWT_SECRET as string;
const TENANT_A = "aaaaaaaa-2727-4000-8000-0000000a0001";
const TENANT_B = "bbbbbbbb-2727-4000-8000-0000000b0001";
const ACTOR = "cccccccc-2727-4000-8000-0000000c0001";

function auth(tenant: string, roles = ["telephony_admin"]) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s" }, SECRET)}`, "x-tenant-id": tenant };
}
async function asTenant<T>(tenant: string, fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenant}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}

let app: FastifyInstance;
beforeAll(async () => { registerConsumersOnce(); app = await buildApp(); });
afterAll(async () => {
  await drainQueue();
  for (const t of [TENANT_A, TENANT_B]) {
    await asTenant(t, (sql) => sql`delete from telephony.ivr_actions where tenant_id = ${t}`);
    await asTenant(t, (sql) => sql`delete from telephony.ivr_hits where tenant_id = ${t}`);
    await asTenant(t, (sql) => sql`delete from telephony.calls where tenant_id = ${t}`);
  }
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/telephony/ivr-actions persists (UAT #27)", () => {
  it("accepts (202), the consumer writes telephony.ivr_actions, and GET lists it", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/telephony/ivr-actions", headers: auth(TENANT_A),
      payload: { digit: "7", action: "create_lead", leadSource: "uat_g2_27" },
    });
    expect(res.statusCode).toBe(202);
    const { id, data } = res.json();
    expect(data).toMatchObject({ id, tenantId: TENANT_A, digit: "7", action: "create_lead", leadSource: "uat_g2_27", enabled: true });
    await drainQueue();

    const rows = await asTenant(TENANT_A, (sql) => sql`select digit, action, lead_source, enabled, version, created_by from telephony.ivr_actions where id = ${id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ digit: "7", action: "create_lead", lead_source: "uat_g2_27", enabled: true, version: 1, created_by: ACTOR });

    const list = await app.inject({ method: "GET", url: "/v1/telephony/ivr-actions", headers: auth(TENANT_A, ["telephony_user"]) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((a: { id: string }) => a.id)).toContain(id);
  });

  it("is tenant-isolated: another tenant does not see the action", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/telephony/ivr-actions", headers: auth(TENANT_B) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toEqual([]);
  });

  it("keeps validation + RBAC: bad body 400, non-admin 403, anonymous 401", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/telephony/ivr-actions", headers: auth(TENANT_A), payload: { digit: "1", action: "bogus" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/telephony/ivr-actions", headers: auth(TENANT_A, ["telephony_user"]), payload: { digit: "1", action: "send_sms" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/telephony/ivr-actions", payload: { digit: "1", action: "send_sms" } })).statusCode).toBe(401);
  });
});

describe("POST /v1/telephony/calls/:id/ivr-hits unknown call (UAT observation)", () => {
  const hits = [{ menuKey: "main", digit: "1", timestamp: "2026-10-28T10:00:00Z" }];

  it("404 for a call id that does not exist, and persists nothing", async () => {
    const callId = randomUUID();
    const res = await app.inject({ method: "POST", url: `/v1/telephony/calls/${callId}/ivr-hits`, headers: auth(TENANT_A), payload: { hits } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("CALL_NOT_FOUND");
    await drainQueue();
    const n = await asTenant(TENANT_A, (sql) => sql`select count(*)::int as n from telephony.ivr_hits where call_id = ${callId}`);
    expect(n[0]!.n).toBe(0);
  });

  it("404 for a call that belongs to another tenant", async () => {
    const callId = randomUUID();
    await seedCall(TENANT_B, callId);
    const res = await app.inject({ method: "POST", url: `/v1/telephony/calls/${callId}/ivr-hits`, headers: auth(TENANT_A), payload: { hits } });
    expect(res.statusCode).toBe(404);
  });

  it("202 for an existing call in the caller's tenant", async () => {
    const callId = randomUUID();
    await seedCall(TENANT_A, callId);
    const res = await app.inject({ method: "POST", url: `/v1/telephony/calls/${callId}/ivr-hits`, headers: auth(TENANT_A), payload: { hits } });
    expect(res.statusCode).toBe(202);
    await drainQueue();
  });
});
