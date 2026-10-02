/**
 * FR 53 (payroll paid suspended employees full salary): HRMS side.
 *
 *  - POST /v1/hrms/suspensions/:suspId/subsistence-review records the
 *    competent authority's review order (migration 0168), audited.
 *  - activePaySuspendedEmployeeIds -- the payroll-input feed's source --
 *    returns the suspension window and the recorded order, tenant-scoped,
 *    and no longer caps the tenant at 500 suspensions.
 *
 * Real Postgres, real F3 consumer on a MemoryQueue (apar-nested-tx pattern).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { registerF3_disciplinary_Consumers } from "../src/modules/disciplinary/f3-consumer.js";
import { activePaySuspendedEmployeeIds } from "../src/modules/disciplinary/repo.js";
import { hrmsSuspensions } from "../src/modules/disciplinary/schema.js";
import { COMMANDS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

async function seedSuspension(tenant: string, o: { status?: string; paySuspended?: boolean; fromDate?: string } = {}) {
  const id = randomUUID();
  const employeeId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, tenant, (tx: any) => tx.insert(hrmsSuspensions).values({
    id, tenantId: tenant, employeeId, fromDate: o.fromDate ?? "2026-05-01",
    paySuspended: o.paySuspended ?? true, subsistencePct: "50.00", status: o.status ?? "active",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return { id, employeeId };
}

async function post(suspId: string, payload: unknown, roles = ["hr_admin"]) {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-fr53" }, SECRET);
  const app = await buildApp();
  const r = await app.inject({
    method: "POST", url: `/v1/hrms/suspensions/${suspId}/subsistence-review`,
    headers: { authorization: `Bearer ${token}` }, payload: payload as Record<string, unknown>,
  });
  await app.close();
  return r;
}

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/hrms/suspensions/:suspId/subsistence-review (route validation)", () => {
  it("accepts a valid review order (202)", async () => {
    const s = await seedSuspension(TENANT);
    const r = await post(s.id, { revisedPct: 75, orderRef: "VIG/2026/7", effectiveFrom: "2026-07-30" });
    expect(r.statusCode).toBe(202);
  });
  it.each([
    ["percentage over 100", { revisedPct: 120, orderRef: "X" }],
    ["missing order reference", { revisedPct: 75 }],
    ["unknown field", { revisedPct: 75, orderRef: "X", payPct: 100 }],
  ])("rejects %s (400)", async (_l, body) => {
    const s = await seedSuspension(TENANT);
    expect((await post(s.id, body)).statusCode).toBe(400);
  });
  it("rejects an impossible calendar date such as 2026-02-30 (400)", async () => {
    const s = await seedSuspension(TENANT);
    expect((await post(s.id, { revisedPct: 75, orderRef: "X", effectiveFrom: "2026-02-30" })).statusCode).toBe(400);
  });
  it("rejects an effective date before the suspension started (400)", async () => {
    const s = await seedSuspension(TENANT, { fromDate: "2026-05-01" });
    expect((await post(s.id, { revisedPct: 75, orderRef: "X", effectiveFrom: "2026-04-01" })).statusCode).toBe(400);
  });
  it("409 on a revoked suspension and on one that does not suspend pay", async () => {
    const revoked = await seedSuspension(TENANT, { status: "revoked" });
    expect((await post(revoked.id, { revisedPct: 75, orderRef: "X" })).statusCode).toBe(409);
    const noPay = await seedSuspension(TENANT, { paySuspended: false });
    expect((await post(noPay.id, { revisedPct: 75, orderRef: "X" })).statusCode).toBe(409);
  });
  it("403 for a role outside HR admin", async () => {
    const s = await seedSuspension(TENANT);
    expect((await post(s.id, { revisedPct: 75, orderRef: "X" }, ["hr_officer"])).statusCode).toBe(403);
  });
});

describe("review order write + payroll-input source", () => {
  it("records the order, audits it, and the feed source returns window + order (tenant-scoped)", async () => {
    const s = await seedSuspension(TENANT, { fromDate: "2026-05-01" });
    const other = await seedSuspension(OTHER_TENANT, { fromDate: "2026-06-01" });
    const q = tenantWrappedQueue();
    registerF3_disciplinary_Consumers(q);
    await q.start();
    await q.publish(COMMANDS.f3RouteWrite, {
      messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        op: "disciplinary_routes__4", id: s.id, tenantId: TENANT,
        body: { revisedPct: 25, orderRef: "VIG/2026/9", effectiveFrom: "2026-07-30" },
        params: { suspId: s.id }, query: {},
      },
    });
    await q.drain();
    await q.stop();

    const map = await runWithTenant(TENANT, () => activePaySuspendedEmployeeIds(TENANT));
    expect(map.get(s.employeeId)).toEqual({
      suspensionId: s.id, fromDate: "2026-05-01", toDate: null, subsistencePct: "50.00",
      revisedSubsistencePct: "25.00", revisedEffectiveFrom: "2026-07-30", reviewOrderRef: "VIG/2026/9",
    });
    expect(map.has(other.employeeId)).toBe(false);

    const audit = (await withTenantScope(db, TENANT, (tx: typeof db) => tx.execute(sql`
      SELECT payload->>'action' AS action, payload->>'orderRef' AS ref FROM _outbox.messages
       WHERE tenant_id = ${TENANT}::uuid AND payload->>'resourceType' = 'hrms_suspension' AND payload->>'resourceId' = ${s.id}
    `))) as unknown as Array<{ action: string; ref: string }>;
    expect(audit).toEqual([{ action: "subsistence_review", ref: "VIG/2026/9" }]);
  });

  it("returns every active pay-suspension, not just the first 500", async () => {
    const tenant = randomUUID();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await withTenantScope(db, tenant, (tx: any) => tx.insert(hrmsSuspensions).values(
      Array.from({ length: 501 }, () => ({
        tenantId: tenant, employeeId: randomUUID(), fromDate: "2026-09-01", paySuspended: true,
        subsistencePct: "50.00", status: "active", createdBy: ACTOR, updatedBy: ACTOR,
      })),
    ));
    const map = await runWithTenant(tenant, () => activePaySuspendedEmployeeIds(tenant));
    expect(map.size).toBe(501);
  });
});
