/**
 * B10 (leave routing): tenant A had no leave_approval definition, so every
 * leave application was rejected by workflow-service (unknown_definition) and
 * hrms marked it routing_failed. The catalogue entry also had a start node
 * for the APPLICANT with role refs that exist in no realm (hrms_employee /
 * hrms_manager / hrms_hr), so even a seeded tenant could never approve.
 *
 *  - the catalogue leave_approval is a one-node Reporting Officer chain on the
 *    real `manager` role;
 *  - the backfill CLI selection accepts --code leave_approval and seeds it
 *    into a tenant that lacks it, idempotently;
 *  - a leave instance raised exactly as hrms does gets a `manager` task that a
 *    manager can complete (and a plain employee cannot), and approving it
 *    dispatches hrms.leave.approve for the leave application.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";

// The domain permission (hrms.leave.approve) is resolved by policy-service,
// which is not running here; the role-on-task gate under test is local.
vi.mock("../src/shared/context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/context.js")>();
  return { ...actual, requirePermissionKey: vi.fn(async () => undefined) };
});

import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { STANDARD_DEFINITIONS } from "../src/modules/provisioning/catalog.js";
import { backfillStandardDefinitions, selectDefinitions } from "../src/modules/provisioning/backfill.js";
import { COMMANDS } from "../src/topics.js";
import { TestQueue, cleanup, getInstance, tasksFor, sqlAsTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET as string;
const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

let q: TestQueue;
beforeAll(() => {
  q = new TestQueue();
  registerInstancesConsumers(q);
  registerTasksConsumers(q);
});
afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

/** Exactly what hrms-service leave/consumer.ts publishes on leave apply. */
async function raiseLeave(tenantId: string, leaveAppId: string, applicant: string): Promise<string> {
  const id = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id, tenantId, name: `Leave Approval — ${leaveAppId.slice(0, 8)}`, status: "active", version: 1,
    definitionCode: "leave_approval", initialTaskName: "Reporting Officer Approval",
    refType: "leave_app", refId: leaveAppId,
  }, { tenantId, actorId: applicant, messageId: id });
  return id;
}

async function outbox(tenantId: string, topic: string): Promise<Array<Record<string, unknown>>> {
  const rows = await sqlAsTenant<{ payload: unknown }>(tenantId,
    sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenantId} AND topic = ${topic}`);
  return rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>);
}

async function completeHttp(tenantId: string, taskId: string, roles: string[]) {
  const app = await buildApp();
  try {
    const token = signToken({ sub: randomUUID(), tid: tenantId, roles, sid: "b10-leave" }, SECRET);
    return await app.inject({
      method: "POST", url: `/v1/workflow/tasks/${taskId}/complete`,
      headers: { authorization: `Bearer ${token}` }, payload: { decision: "approve" },
    });
  } finally {
    await app.close();
  }
}

describe("B10 — leave_approval catalogue chain", () => {
  it("is a single Reporting Officer node on the real `manager` role (not the applicant, no hrms_* refs)", () => {
    const leave = STANDARD_DEFINITIONS.find((d) => d.code === "leave_approval");
    expect(leave?.cluster).toBe("hr");
    expect(leave?.nodes).toEqual([{ nodeKey: "manager_approval", name: "Reporting Officer Approval", roleRef: "manager" }]);
  });

  it("the backfill selection accepts --code leave_approval", () => {
    expect(selectDefinitions(["leave_approval"]).map((d) => d.code)).toEqual(["leave_approval"]);
  });
});

describe("B10 — backfilled leave_approval routes a leave application", () => {
  it("before the backfill the instance is rejected (routing_failed upstream); after, a manager task exists", async () => {
    const tenant = newTenant();
    const rejectedId = await raiseLeave(tenant, randomUUID(), randomUUID());
    expect((await getInstance(tenant, rejectedId))?.status).toBe("rejected");
    expect((await outbox(tenant, "workflow.instance.rejected"))[0]).toMatchObject({ reason: "unknown_definition", refType: "leave_app" });

    const dry = await backfillStandardDefinitions(tenant, { actorId: randomUUID(), dryRun: true, defs: selectDefinitions(["leave_approval"]) });
    expect(dry).toMatchObject({ missing: ["leave_approval"], seeded: [] });
    const first = await backfillStandardDefinitions(tenant, { actorId: randomUUID(), defs: selectDefinitions(["leave_approval"]) });
    expect(first.seeded).toEqual(["leave_approval"]);
    const again = await backfillStandardDefinitions(tenant, { actorId: randomUUID(), defs: selectDefinitions(["leave_approval"]) });
    expect(again).toMatchObject({ present: ["leave_approval"], seeded: [] });

    const leaveAppId = randomUUID();
    const id = await raiseLeave(tenant, leaveAppId, randomUUID());
    expect((await getInstance(tenant, id))?.status).toBe("active");
    const ts = await tasksFor(tenant, id);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ node_key: "manager_approval", role_ref: "manager", ref_type: "leave_app", ref_id: leaveAppId, status: "pending" });
  });

  it("a manager may complete the leave task, a plain employee may not; approval dispatches hrms.leave.approve", async () => {
    const tenant = newTenant();
    await backfillStandardDefinitions(tenant, { actorId: randomUUID(), defs: selectDefinitions(["leave_approval"]) });
    const leaveAppId = randomUUID();
    const id = await raiseLeave(tenant, leaveAppId, randomUUID());
    const t = (await tasksFor(tenant, id))[0]!;

    const asEmployee = await completeHttp(tenant, t.id, ["employee", "workflow_user"]);
    expect(asEmployee.statusCode).toBe(403);
    expect(asEmployee.json().code).toBe("ROLE_NOT_AUTHORIZED");
    expect((await completeHttp(tenant, t.id, ["manager"])).statusCode).toBe(202);

    const approver = randomUUID();
    await q.deliver(COMMANDS.completeTask, {
      id: t.id, tenantId: tenant, instanceId: id, name: t.name, status: "pending",
      roleRef: t.role_ref, nodeKey: t.node_key, refType: t.ref_type, refId: t.ref_id,
      decision: "approve",
    }, { tenantId: tenant, actorId: approver, messageId: randomUUID() });

    expect((await getInstance(tenant, id))?.status).toBe("completed");
    const dispatched = await outbox(tenant, "hrms.leave.approve");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ id: leaveAppId, tenantId: tenant, approvedBy: approver });
  });
});
