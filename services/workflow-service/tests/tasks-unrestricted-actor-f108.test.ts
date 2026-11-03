/**
 * UAT F108 follow-up (security): a workflow task with no roleRef was listed to
 * everyone (fixed in tasks-list-visibility-r2) and was still COMPLETABLE and
 * CLAIMABLE by any workflow role-holder who knew its id. Now only its assignee
 * (or a delegate of the assignee), workflow_admin or super_admin may complete
 * it; claiming it is for workflow admins. Anyone else gets 403
 * TASK_NOT_AUTHORIZED, the refusal is audited (transition_history "blocked" +
 * an audit.event.record outbox row) and nothing is queued. The same applies to
 * approve, reject and return (all decisions of completeTask) and to bulk-complete.
 */
import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { completeTask, claimTask, bulkComplete } from "../src/modules/tasks/commands.js";
import { sqlAsTenant, asTenant, cleanup } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET as string;
const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }
afterEach(async () => { vi.restoreAllMocks(); if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

const ctx = (tenantId: string, actorId: string, roles: string[]): RequestContext =>
  ({ tenantId, actorId, roles, correlationId: randomUUID(), sessionId: "s-f108" }) as RequestContext;

async function seed(tenant: string, o: { roleRef: string | null; assigneeId?: string | null }): Promise<string> {
  const submitter = randomUUID();
  const inst = randomUUID();
  const task = randomUUID();
  await sqlAsTenant(tenant, sql`
    INSERT INTO workflow.instances (id, tenant_id, name, status, created_by, updated_by)
    VALUES (${inst}, ${tenant}, 'F108 fixture', 'active', ${submitter}, ${submitter})`);
  await sqlAsTenant(tenant, sql`
    INSERT INTO workflow.tasks (id, tenant_id, instance_id, name, status, role_ref, node_key, assignee_id, is_call, created_by, updated_by)
    VALUES (${task}, ${tenant}, ${inst}, 'Finance Officer Approval', 'pending', ${o.roleRef}, 'n1', ${o.assigneeId ?? null}, false, ${submitter}, ${submitter})`);
  return task;
}

async function auditTrail(tenant: string, taskId: string) {
  const history = await sqlAsTenant(tenant, sql`
    SELECT action, actor_id::text AS actor_id, detail FROM workflow.transition_history WHERE tenant_id = ${tenant}::uuid AND task_id = ${taskId}::uuid`) as unknown as Array<{ action: string; actor_id: string; detail: Record<string, unknown> }>;
  const outbox = await sqlAsTenant(tenant, sql`
    SELECT actor_id::text AS actor_id, payload FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid AND topic = 'audit.event.record' AND payload->>'resourceId' = ${taskId}`) as unknown as Array<{ actor_id: string; payload: Record<string, unknown> }>;
  return { history, outbox };
}

function spyCompletes() {
  const published: unknown[] = [];
  const orig = queue.publish.bind(queue);
  vi.spyOn(queue, "publish").mockImplementation(async (topic: string, msg: unknown) => {
    if (topic === COMMANDS.completeTask) { published.push(msg); return; }
    return orig(topic as never, msg as never);
  });
  return published;
}

describe("acting on a task with no roleRef (UAT F108 follow-up)", () => {
  it.each(["approve", "reject", "return"] as const)("an unrelated role-holder cannot %s it: 403, audited, nothing queued", async (decision) => {
    const tenant = newTenant();
    const taskId = await seed(tenant, { roleRef: null });
    const published = spyCompletes();
    const hr = randomUUID();
    await expect(asTenant(tenant, () => completeTask(ctx(tenant, hr, ["hr_admin", "manager"]), taskId, decision)))
      .rejects.toMatchObject({ status: 403, code: "TASK_NOT_AUTHORIZED" });
    expect(published).toHaveLength(0);
    const { history, outbox } = await auditTrail(tenant, taskId);
    expect(history).toEqual([expect.objectContaining({ action: "blocked", actor_id: hr, detail: { reason: "unrestricted_task_not_authorized", op: "complete" } })]);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.actor_id).toBe(hr);
    expect(outbox[0]!.payload).toMatchObject({ action: "task.complete.denied", outcome: "denied", resourceType: "workflow_task" });
  });

  it("someone other than the assignee is refused even when the task is assigned", async () => {
    const tenant = newTenant();
    const taskId = await seed(tenant, { roleRef: null, assigneeId: randomUUID() });
    await expect(asTenant(tenant, () => completeTask(ctx(tenant, randomUUID(), ["manager"]), taskId, "approve")))
      .rejects.toMatchObject({ status: 403, code: "TASK_NOT_AUTHORIZED" });
  });

  it("the assignee, a workflow_admin and a super_admin may complete it", async () => {
    const tenant = newTenant();
    const assignee = randomUUID();
    const published = spyCompletes();
    const t1 = await seed(tenant, { roleRef: null, assigneeId: assignee });
    expect((await asTenant(tenant, () => completeTask(ctx(tenant, assignee, ["manager"]), t1, "approve"))).status).toBe("accepted");
    const t2 = await seed(tenant, { roleRef: null });
    expect((await asTenant(tenant, () => completeTask(ctx(tenant, randomUUID(), ["workflow_admin"]), t2, "reject"))).status).toBe("accepted");
    const t3 = await seed(tenant, { roleRef: null });
    expect((await asTenant(tenant, () => completeTask(ctx(tenant, randomUUID(), ["super_admin"]), t3, "approve"))).status).toBe("accepted");
    expect(published).toHaveLength(3);
  });

  it("a task WITH a roleRef is unchanged: its role-holder may complete it", async () => {
    const tenant = newTenant();
    const published = spyCompletes();
    const taskId = await seed(tenant, { roleRef: "manager" });
    expect((await asTenant(tenant, () => completeTask(ctx(tenant, randomUUID(), ["manager"]), taskId, "approve"))).status).toBe("accepted");
    expect(published).toHaveLength(1);
  });

  it("claim: an unrelated role-holder is refused and audited; a workflow_admin may claim", async () => {
    const tenant = newTenant();
    const taskId = await seed(tenant, { roleRef: null });
    const someone = randomUUID();
    await expect(asTenant(tenant, () => claimTask(ctx(tenant, someone, ["manager"]), taskId)))
      .rejects.toMatchObject({ status: 403, code: "TASK_NOT_AUTHORIZED" });
    const { history, outbox } = await auditTrail(tenant, taskId);
    expect(history[0]).toMatchObject({ action: "blocked", detail: { op: "claim" } });
    expect(outbox[0]!.payload).toMatchObject({ action: "task.claim.denied" });
    const admin = randomUUID();
    const claimed = await asTenant(tenant, () => claimTask(ctx(tenant, admin, ["workflow_admin"]), taskId));
    expect(claimed.assigneeId).toBe(admin);
  });

  it("bulk-complete reports the refusal per task and queues nothing for it", async () => {
    const tenant = newTenant();
    const published = spyCompletes();
    const taskId = await seed(tenant, { roleRef: null });
    const [r] = await asTenant(tenant, () => bulkComplete(ctx(tenant, randomUUID(), ["manager"]), [taskId], "approve"));
    expect(r).toMatchObject({ id: taskId, ok: false, code: "TASK_NOT_AUTHORIZED" });
    expect(published).toHaveLength(0);
  });

  it("POST /v1/workflow/tasks/:id/complete answers 403 TASK_NOT_AUTHORIZED to an HR officer", async () => {
    const tenant = newTenant();
    const taskId = await seed(tenant, { roleRef: null });
    const token = signToken({ sub: randomUUID(), tid: tenant, roles: ["hr_admin", "manager"], sid: "sess-f108" }, SECRET);
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "POST", url: `/v1/workflow/tasks/${taskId}/complete`, headers: { authorization: `Bearer ${token}` }, payload: { decision: "approve" } });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { code: string }).code).toBe("TASK_NOT_AUTHORIZED");
    } finally {
      await app.close();
    }
  });
});
