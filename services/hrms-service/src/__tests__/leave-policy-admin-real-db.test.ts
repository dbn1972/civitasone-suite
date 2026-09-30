/**
 * Leave policy admin routes — real-DB round-trip regression test.
 *
 * GAP-HR-LEAVE-POLICIES-03: POST/PATCH/DELETE are queued writes
 * (publishF3Write, applied later by f3-consumer.ts) but used to reply
 * 201/200/204 as if already applied. Now 202 {id,status:"accepted",
 * correlationId}.
 *
 * Also fixes a latent, more severe bug found while implementing the above:
 * every one of these three routes called publishF3Write with a FRESH
 * `randomUUID()` as the message id instead of the route's own `id` (POST's
 * locally-generated id / PATCH+DELETE's URL :id param) — so
 * f3-consumer.ts's `const id = p.id || params.id` always took the
 * unrelated random one (p.id, truthy), meaning PATCH/DELETE updated a
 * row that never existed (a silent no-op) and POST's real inserted row's
 * id never matched what the route replied to the client. This test proves
 * the id the client receives is the id actually written, and that PATCH/
 * DELETE genuinely mutate the created row.
 *
 * GAP-HR-LEAVE-POLICIES-01/02: also proves the updated HR_ADMIN_ROLES
 * (dropped "admin", added tenant_admin/platform_admin) end to end.
 *
 * GAP-HR-LEAVE-POLICIES-04: DELETE deactivates (isActive=false); PATCH
 * {isActive:true} reactivates. Also proves a PATCH touching only ONE field
 * does not reset every other field to its create-schema default (a partial
 * update, not a partial re-create) — see policy-admin-routes.ts's comment
 * on why the route forwards the *parsed* body, not raw req.body.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerF3_leave_Consumers } from "../modules/leave/f3-consumer.js";

registerF3_leave_Consumers(queue);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-90a1-4000-8000-000000000090";
const SEED_ACTOR = "facade00-90a1-4000-8000-0000000000ff";
const LEAVE_TYPE_ID = "facade00-90a1-4000-8000-0000000000ca";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-policy-admin-test" }, SECRET);
}
// sub must be a real UUID: the f3 consumer writes msg.actorId straight into
// hrms_leave_policy_rules.created_by/updated_by, both uuid columns.
const hrAdminToken = tok(["hr_admin"], "facade00-90a1-4000-8000-0000000000a1");
const tenantAdminToken = tok(["tenant_admin"], "facade00-90a1-4000-8000-0000000000a2");
const hrOfficerToken = tok(["hr_officer"], "facade00-90a1-4000-8000-0000000000a3");

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function drainQueue(): Promise<void> {
  // MemoryQueue.publish() resolves before its consumer runs; drain() forces
  // every in-flight delivery to finish before the test reads the DB.
  await (queue as unknown as { drain: () => Promise<void> }).drain();
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_policy_rules WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM leave.hrms_leave_types WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`
    INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${LEAVE_TYPE_ID}, ${TENANT}, 'PADM', 'Policy Admin Test Type', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("leave policy admin routes — GAP-HR-LEAVE-POLICIES-01/02/03/04", () => {
  it("hr_officer is denied (widening leave-policy admin to it needs HR sign-off, not done here)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/admin/leave-policies",
      headers: { authorization: `Bearer ${hrOfficerToken}` },
      payload: { leaveTypeId: LEAVE_TYPE_ID, employeeType: "permanent", maxDaysPerYear: 30 },
    });
    expect(r.statusCode).toBe(403);
  });

  it("POST returns 202 {id,status:accepted,correlationId}, and the row that lands in the DB has that SAME id (not an unrelated random one)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/admin/leave-policies",
      headers: { authorization: `Bearer ${hrAdminToken}` },
      payload: {
        leaveTypeId: LEAVE_TYPE_ID, employeeType: "permanent", maxDaysPerYear: 30,
        carryForward: true, maxAccumulation: 60, encashable: true,
      },
    });
    expect(r.statusCode).toBe(202);
    const body = JSON.parse(r.body) as { id: string; status: string; correlationId: string };
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeTruthy();

    await drainQueue();
    const rows = await asTenant((tx) => tx`SELECT * FROM leave.hrms_leave_policy_rules WHERE id = ${body.id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenant_id).toBe(TENANT);
    expect(rows[0]!.max_days_per_year).toBe(30);
    expect(rows[0]!.carry_forward).toBe(true);
    expect(rows[0]!.max_accumulation).toBe(60);
    expect(rows[0]!.is_active).toBe(true);
  });

  it("PATCH updates only the sent field(s) — other fields are NOT reset to the create schema's defaults — and DELETE/reactivate-PATCH round-trip isActive (tenant_admin also authorised)", async () => {
    const created = await app.inject({
      method: "POST", url: "/v1/hrms/admin/leave-policies",
      headers: { authorization: `Bearer ${hrAdminToken}` },
      payload: {
        leaveTypeId: LEAVE_TYPE_ID, employeeType: "contractual", maxDaysPerYear: 12,
        carryForward: true, maxAccumulation: 24, encashable: true,
      },
    });
    expect(created.statusCode).toBe(202);
    await drainQueue();
    const { id } = JSON.parse(created.body) as { id: string };

    // PATCH only maxDaysPerYear, as tenant_admin (GAP-HR-LEAVE-POLICIES-01/02).
    const patched = await app.inject({
      method: "PATCH", url: `/v1/hrms/admin/leave-policies/${id}`,
      headers: { authorization: `Bearer ${tenantAdminToken}` },
      payload: { maxDaysPerYear: 15 },
    });
    expect(patched.statusCode).toBe(202);
    await drainQueue();

    let rows = await asTenant((tx) => tx`SELECT * FROM leave.hrms_leave_policy_rules WHERE id = ${id}`);
    expect(rows[0]!.max_days_per_year).toBe(15);
    // carryForward/maxAccumulation/encashable must survive untouched — a
    // partial PATCH is not a partial re-create back to createPolicyBody's
    // .default(...) values.
    expect(rows[0]!.carry_forward).toBe(true);
    expect(rows[0]!.max_accumulation).toBe(24);
    expect(rows[0]!.encashable).toBe(true);

    // DELETE deactivates.
    const deleted = await app.inject({
      method: "DELETE", url: `/v1/hrms/admin/leave-policies/${id}`,
      headers: { authorization: `Bearer ${hrAdminToken}` },
      payload: { reason: "Scheme withdrawn for this employee type" },
    });
    expect(deleted.statusCode).toBe(202);
    await drainQueue();
    rows = await asTenant((tx) => tx`SELECT * FROM leave.hrms_leave_policy_rules WHERE id = ${id}`);
    expect(rows[0]!.is_active).toBe(false);

    // PATCH {isActive:true} reactivates (previously impossible: updatePolicyBody had no isActive field at all).
    const reactivated = await app.inject({
      method: "PATCH", url: `/v1/hrms/admin/leave-policies/${id}`,
      headers: { authorization: `Bearer ${hrAdminToken}` },
      payload: { isActive: true },
    });
    expect(reactivated.statusCode).toBe(202);
    await drainQueue();
    rows = await asTenant((tx) => tx`SELECT * FROM leave.hrms_leave_policy_rules WHERE id = ${id}`);
    expect(rows[0]!.is_active).toBe(true);
    // Reactivating must not have touched the unrelated field PATCHed earlier.
    expect(rows[0]!.max_days_per_year).toBe(15);
  });
});
