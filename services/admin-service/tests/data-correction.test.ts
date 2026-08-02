/**
 * CAP-100 — data-correction governance route integration (admin-service).
 * propose → maker-checker approve (event emitted) → reject → RLS isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "eeeeeeee-aaaa-4000-8000-0000000000a1";
const OTHER = "eeeeeeee-aaaa-4000-8000-0000000000a2";
const PROPOSER = "11111111-aaaa-4000-8000-000000000001";
const APPROVER = "22222222-aaaa-4000-8000-000000000002";

function auth(actor: string, roles: string[] = ["tenant_admin"], tenantId = TENANT) {
  return { authorization: `Bearer ${signToken({ sub: actor, tid: tenantId, roles, sid: "s" }, SECRET, 3600)}` };
}
let app: FastifyInstance;

function readAsTenant<T>(tid: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => { await sql`SELECT set_config('app.tenant_id', ${tid}, true)`; return run(sql as typeof sqlClient); }) as Promise<T>;
}

/**
 * Test-hygiene fix: this file created a correction per test and never removed
 * any of them, so `support.admin_data_corrections` grew on every run.
 *
 * That breaks the reject test deterministically once the pile is large enough.
 * `GET /v1/admin/support/data-corrections` defaults to `limit=50` and orders by
 * `created_at` ASCENDING — oldest first — so a freshly rejected correction is
 * always the LAST row and stops being returned as soon as 50 rejected rows
 * exist. The suite had reached 55 rejected / 110 pending / 55 approved, so the
 * assertion could never pass again regardless of correct product behaviour.
 *
 * Wiping on both sides makes the file self-contained and order-independent,
 * matching the rest of this service's suite.
 */
async function wipe(): Promise<void> {
  for (const t of [TENANT, OTHER]) {
    await readAsTenant(t, async (sql) => {
      await sql`DELETE FROM support.admin_data_corrections WHERE tenant_id = ${t}`;
      await sql`DELETE FROM _outbox.messages WHERE tenant_id = ${t}`;
    });
  }
}

beforeAll(async () => { app = await buildApp(); await wipe(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });
async function propose(actor = PROPOSER, tenantId = TENANT): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/support/data-corrections", headers: auth(actor, ["tenant_admin"], tenantId),
    payload: { targetTable: "citizen.profiles", targetId: "abc-123", justification: "Correcting a mistyped surname per ticket", proposedChange: { surname: "Nayak" } },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe("data-correction governance", () => {
  it("requires a justification (rejected by validation)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/admin/support/data-corrections", headers: auth(PROPOSER),
      payload: { targetTable: "t", targetId: "1", justification: "short", proposedChange: { a: 1 } } });
    expect(res.statusCode).toBe(400);
  });

  it("blocks the proposer from approving their own correction", async () => {
    const id = await propose();
    const res = await app.inject({ method: "POST", url: `/v1/admin/support/data-corrections/${id}/approve`, headers: auth(PROPOSER), payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
  });

  it("a distinct approver approves and emits a delegation event", async () => {
    const id = await propose();
    const res = await app.inject({ method: "POST", url: `/v1/admin/support/data-corrections/${id}/approve`, headers: auth(APPROVER), payload: {} });
    expect(res.statusCode).toBe(200);
    const events = await readAsTenant(TENANT, (sql) => sql<Array<{ topic: string; payload: string }>>`
      SELECT topic, payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'admin.data_correction.approved'`);
    const mine = events.map((e) => (typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload)).filter((p) => p.id === id);
    expect(mine.length).toBe(1);
    expect(mine[0].targetTable).toBe("citizen.profiles");

    const again = await app.inject({ method: "POST", url: `/v1/admin/support/data-corrections/${id}/approve`, headers: auth(APPROVER), payload: {} });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("NOT_PENDING");
  });

  it("rejects a correction with a reason", async () => {
    const id = await propose();
    const res = await app.inject({ method: "POST", url: `/v1/admin/support/data-corrections/${id}/reject`, headers: auth(APPROVER), payload: { reason: "not warranted" } });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/v1/admin/support/data-corrections?status=rejected", headers: auth(APPROVER) });
    expect((list.json().data as Array<{ id: string }>).some((r) => r.id === id)).toBe(true);
  });

  it("RLS: another tenant cannot see this tenant corrections", async () => {
    const id = await propose();
    const other = await app.inject({ method: "GET", url: "/v1/admin/support/data-corrections", headers: auth(PROPOSER, ["tenant_admin"], OTHER) });
    expect((other.json().data as Array<{ id: string }>).some((r) => r.id === id)).toBe(false);
  });
});
