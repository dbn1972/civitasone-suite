/**
 * SVC-130 — cross-tenant RLS isolation for the change/release module.
 *
 * Tenant A raises a change; Tenant B must never see it in a list, read it by id,
 * or drive its state machine. Enforced by Postgres RLS (migration 0013), not
 * merely an app-layer WHERE.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { registerF3_change_Consumers } from "../src/modules/change/f3-consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-eeee-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-eeee-4000-8000-000000000002";
const ACTOR_A = "aaaaaaaa-eeee-4000-8000-aaaaaaaaaaaa";
const ACTOR_B = "bbbbbbbb-eeee-4000-8000-bbbbbbbbbbbb";

function tokenFor(tenantId: string, actorId: string): string {
  return signToken({ sub: actorId, tid: tenantId, roles: ["tenant_admin", "super_admin"], sid: "sess-rls-chg" }, SECRET, 3600);
}
function hdr(tenantId: string, actorId: string) {
  return { authorization: `Bearer ${tokenFor(tenantId, actorId)}` };
}

let app: FastifyInstance;
let changeId: string;

beforeAll(async () => {
  // POST /v1/admin/change/requests was converted to F3 async (202); the
  // consumer that applies it only runs in src/worker.ts in production, so
  // register it here against the real queue singleton buildApp() wires the
  // routes through — same pattern as tests/change.test.ts.
  registerF3_change_Consumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
  const title = `Tenant A only change ${randomUUID()}`;
  const res = await app.inject({
    method: "POST", url: "/v1/admin/change/requests", headers: hdr(TENANT_A, ACTOR_A),
    payload: {
      title, type: "standard", risk: "low",
      affectedServices: ["admin-service"], description: "Isolation probe change request.",
      rollbackPlan: "No-op; revert config.",
    },
  });
  expect(res.statusCode).toBe(202);
  await (queue as any).drain?.();
  // change/f3-apply.ts's apply_change_0 (create) mints its own randomUUID()
  // instead of forwarding the route-generated id into repo.insertRequest() —
  // real, pre-existing, out of this batch's scope (see tests/change.test.ts's
  // createChange() for the full writeup). Look the real id up by the unique
  // title instead of trusting the id echoed in the 202 response.
  const list = await app.inject({ method: "GET", url: "/v1/admin/change/requests", headers: hdr(TENANT_A, ACTOR_A) });
  const rows = list.json().data as Array<{ id: string; title: string }>;
  const match = rows.find((r) => r.title === title);
  if (!match) throw new Error(`created change '${title}' never landed`);
  changeId = match.id;
});
afterAll(async () => { await app.close(); await queue.stop(); await sqlClient.end(); });

describe("Change — Cross-Tenant RLS Isolation", () => {
  it("Tenant B list never contains Tenant A's change", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/change/requests", headers: hdr(TENANT_B, ACTOR_B) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ id: string }>;
    expect(data.find((c) => c.id === changeId)).toBeUndefined();
  });

  it("Tenant B GET by id returns 404 (not another tenant's row)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/change/requests/${changeId}`, headers: hdr(TENANT_B, ACTOR_B) });
    expect(res.statusCode).toBe(404);
  });

  // GAP (not a stale-status-code issue, left unfixed): change/routes.ts'
  // submit endpoint has NO synchronous existence/tenant-ownership check at
  // all — unlike approve/reject in tests/change.test.ts's documented GAPs,
  // it does not even read the row before publishing, so it blindly accepts
  // (200) a submit for an id that does not belong to the caller's tenant.
  // The write itself should still be scoped correctly once the F3 consumer
  // applies it (repo/RLS enforce tenant_id), but the HTTP response gives the
  // caller no way to observe that their submit was rejected.
  it("Tenant B cannot submit Tenant A's change (404 under RLS)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/admin/change/requests/${changeId}/submit`, headers: hdr(TENANT_B, ACTOR_B) });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant A still sees and can drive its own change", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/change/requests/${changeId}`, headers: hdr(TENANT_A, ACTOR_A) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(changeId);
  });

  it("the persisted row carries Tenant A's tenant_id only", async () => {
    // Read with Tenant A's GUC set on the connection so RLS admits the row;
    // proves it persisted, and (below) that Tenant B's GUC cannot see it.
    const rows = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`SELECT tenant_id FROM change.change_requests WHERE id = ${changeId}`;
    });
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(TENANT_A);

    // Same query under Tenant B's GUC is filtered to zero rows by RLS.
    const asB = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_B}, true)`;
      return sql`SELECT tenant_id FROM change.change_requests WHERE id = ${changeId}`;
    });
    expect(asB.length).toBe(0);
  });
});
