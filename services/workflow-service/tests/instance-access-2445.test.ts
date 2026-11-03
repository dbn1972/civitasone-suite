/**
 * UAT #2445 security review, items 2-5 (workflow-service):
 *  2. GET /v1/workflow/tasks?instanceId= listed every task of any instance to any role-holder.
 *  3. GET /v1/workflow/workbaskets/:code/tasks ran the basket filter over the whole tenant.
 *  4. Instance detail, search, history and the instance timeline were role-gated only.
 *  5. The completion consumer did not re-check the assignee under the lock (reassignment window).
 * Instance data is now for its participants (requester, or holder / assignee / completer of one
 * of its tasks) plus super_admin / workflow_admin; a non-participant gets 404. A participant still
 * sees the whole chain of their instance (the estab panel relies on it). Baskets resolve over the
 * caller's own pool. A completion whose task was reassigned before it applied is refused and audited.
 */
import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { completeTask } from "../src/modules/tasks/commands.js";
import * as wbRepo from "../src/modules/workbaskets/repo.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { TestQueue, seedDefinition, sqlAsTenant, asTenant, cleanup } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET as string;
const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }
afterEach(async () => { vi.restoreAllMocks(); if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

const auth = (tenant: string, roles: string[], sub = randomUUID()) =>
  ({ authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "s-2445" }, SECRET)}` });

type Fixture = { tenant: string; inst: string; submitter: string; completer: string; assignee: string };

/** One instance with a manager task, a finance task, a role-less task completed by `completer`, a finance task assigned to `assignee`. */
async function seedInstance(): Promise<Fixture> {
  const tenant = newTenant();
  const submitter = randomUUID(), completer = randomUUID(), assignee = randomUUID();
  const inst = randomUUID();
  await sqlAsTenant(tenant, sql`
    INSERT INTO workflow.instances (id, tenant_id, name, status, created_by, updated_by)
    VALUES (${inst}, ${tenant}, 'Budget Approval Workflow', 'active', ${submitter}, ${submitter})`);
  const t = (name: string, status: string, role: string | null, extra: { completedBy?: string; assigneeId?: string } = {}) => sqlAsTenant(tenant, sql`
    INSERT INTO workflow.tasks (id, tenant_id, instance_id, name, status, role_ref, completed_by, assignee_id, is_call, created_by, updated_by)
    VALUES (${randomUUID()}, ${tenant}, ${inst}, ${name}, ${status}, ${role}, ${extra.completedBy ?? null}, ${extra.assigneeId ?? null}, false, ${submitter}, ${submitter})`);
  await t("Reporting Officer Approval", "pending", "manager");
  await t("Accounts Check", "pending", "finance_accountant");
  await t("Dept Head Approval", "completed", null, { completedBy: completer });
  await t("Finance Officer Approval", "pending", "finance_approver", { assigneeId: assignee });
  return { tenant, inst, submitter, completer, assignee };
}

async function withApp<T>(fn: (app: FastifyInstance) => Promise<T>): Promise<T> {
  const app = await buildApp();
  try { return await fn(app); } finally { await app.close(); }
}

describe("instance task list and instance reads are for participants (items 2 and 4)", () => {
  it("a non-participant HR officer gets 404 on the task list, detail, history and timeline, and the instance is not in search", async () => {
    const f = await seedInstance();
    await withApp(async (app) => {
      const h = auth(f.tenant, ["hr_officer", "workflow_user"]);
      for (const url of [
        `/v1/workflow/tasks?instanceId=${f.inst}`,
        `/v1/workflow/instances/${f.inst}`,
        `/v1/workflow/instances/${f.inst}/history`,
        `/v1/workflow/timeline?entityType=instance&entityId=${f.inst}`,
      ]) {
        const res = await app.inject({ method: "GET", url, headers: h });
        expect(res.statusCode, url).toBe(404);
      }
      const search = await app.inject({ method: "GET", url: "/v1/workflow/instances/search?limit=50", headers: h });
      expect(search.statusCode).toBe(200);
      expect((search.json() as { data: Array<{ id: string }> }).data.map((r) => r.id)).not.toContain(f.inst);
    });
  });

  it("participants (role holder, requester, completer, assignee) and admins see the instance and its whole chain", async () => {
    const f = await seedInstance();
    await withApp(async (app) => {
      const callers: Array<[string, Record<string, string>]> = [
        ["role holder", auth(f.tenant, ["workflow_user", "manager"])],
        ["requester", auth(f.tenant, ["workflow_user"], f.submitter)],
        ["completer", auth(f.tenant, ["workflow_user"], f.completer)],
        ["assignee", auth(f.tenant, ["workflow_user"], f.assignee)],
        ["workflow_admin", auth(f.tenant, ["workflow_admin"])],
        ["super_admin", auth(f.tenant, ["super_admin"])],
      ];
      for (const [who, h] of callers) {
        const list = await app.inject({ method: "GET", url: `/v1/workflow/tasks?instanceId=${f.inst}&limit=50`, headers: h });
        expect(list.statusCode, who).toBe(200);
        expect((list.json() as { data: unknown[] }).data, who).toHaveLength(4);
        expect((await app.inject({ method: "GET", url: `/v1/workflow/instances/${f.inst}`, headers: h })).statusCode, who).toBe(200);
        expect((await app.inject({ method: "GET", url: `/v1/workflow/instances/${f.inst}/history`, headers: h })).statusCode, who).toBe(200);
        expect((await app.inject({ method: "GET", url: `/v1/workflow/timeline?entityType=instance&entityId=${f.inst}`, headers: h })).statusCode, who).toBe(200);
        const search = await app.inject({ method: "GET", url: "/v1/workflow/instances/search?limit=50", headers: h });
        expect((search.json() as { data: Array<{ id: string }> }).data.map((r) => r.id), who).toContain(f.inst);
      }
    });
  });
});

describe("GET /v1/workflow/instances lists only instances the caller participates in (instance-list follow-up)", () => {
  const listIds = async (app: FastifyInstance, h: Record<string, string>) => {
    const res = await app.inject({ method: "GET", url: "/v1/workflow/instances?limit=50", headers: h });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: Array<{ id: string }> }).data.map((r) => r.id);
  };

  it("a non-participant HR officer does not see the instance in the plain list", async () => {
    const f = await seedInstance();
    await withApp(async (app) => {
      expect(await listIds(app, auth(f.tenant, ["hr_officer", "workflow_user"]))).not.toContain(f.inst);
    });
  });

  it("participants and admins do; a cached admin page is never served to a non-participant", async () => {
    const f = await seedInstance();
    await withApp(async (app) => {
      expect(await listIds(app, auth(f.tenant, ["workflow_admin"]))).toContain(f.inst); // warms the unscoped slot
      expect(await listIds(app, auth(f.tenant, ["hr_officer", "workflow_user"]))).not.toContain(f.inst);
      expect(await listIds(app, auth(f.tenant, ["super_admin"]))).toContain(f.inst);
      expect(await listIds(app, auth(f.tenant, ["workflow_user", "manager"]))).toContain(f.inst);
      expect(await listIds(app, auth(f.tenant, ["workflow_user"], f.submitter))).toContain(f.inst);
      expect(await listIds(app, auth(f.tenant, ["workflow_user"], f.completer))).toContain(f.inst);
      expect(await listIds(app, auth(f.tenant, ["workflow_user"], f.assignee))).toContain(f.inst);
    });
  });
});

describe("sibling per-instance reads are participant-gated too (delta review items 1-2)", () => {
  const urls = (inst: string) => [
    `/v1/workflow/history/instance/${inst}`,
    `/v1/workflow/instances/${inst}/finalization`,
    `/v1/workflow/instances/${inst}/subscriptions`,
  ];

  it("a non-participant holding the route roles gets 404 on history, finalization and subscriptions", async () => {
    const f = await seedInstance();
    await withApp(async (app) => {
      for (const url of urls(f.inst)) {
        const res = await app.inject({ method: "GET", url, headers: auth(f.tenant, ["workflow_user", "hr_officer"]) });
        expect(res.statusCode, url).toBe(404);
      }
    });
  });

  it("the requester and an admin read them", async () => {
    const f = await seedInstance();
    await withApp(async (app) => {
      for (const h of [auth(f.tenant, ["workflow_user"], f.submitter), auth(f.tenant, ["workflow_admin"])]) {
        for (const url of urls(f.inst)) {
          const res = await app.inject({ method: "GET", url, headers: h });
          expect(res.statusCode, url).toBe(200);
        }
      }
    });
  });
});

describe("workbasket tasks resolve over the caller's own pool (item 3)", () => {
  it("a member sees tasks for roles they hold or assigned to them; admins see the whole basket", async () => {
    const f = await seedInstance();
    await asTenant(f.tenant, () => wbRepo.upsert({ tenantId: f.tenant, code: "open", name: "Open", filter: { status: ["pending"] }, sortOrder: "created_at", actorId: f.submitter }));
    await withApp(async (app) => {
      const names = async (h: Record<string, string>) => {
        const res = await app.inject({ method: "GET", url: "/v1/workflow/workbaskets/open/tasks", headers: h });
        expect(res.statusCode).toBe(200);
        return (res.json() as { data: Array<{ name: string }> }).data.map((t) => t.name).sort();
      };
      expect(await names(auth(f.tenant, ["workflow_user", "manager"]))).toEqual(["Reporting Officer Approval"]);
      expect(await names(auth(f.tenant, ["workflow_user", "finance_accountant"]))).toEqual(["Accounts Check"]);
      expect(await names(auth(f.tenant, ["workflow_user"], f.assignee))).toEqual(["Finance Officer Approval"]);
      expect(await names(auth(f.tenant, ["case_manager"]))).toEqual([]);
      expect(await names(auth(f.tenant, ["workflow_admin"]))).toEqual(["Accounts Check", "Finance Officer Approval", "Reporting Officer Approval"]);
    });
  });
});

describe("completion re-checks the assignee under the lock (item 5)", () => {
  async function setup(assignee: string) {
    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);
    const tenant = newTenant();
    const submitter = randomUUID();
    const def = await seedDefinition(tenant, [
      { nodeKey: "step1", name: "Review", roleRef: "manager", nodeType: "task", sortOrder: 1 },
      { nodeKey: "step2", name: "Approve", roleRef: "manager", nodeType: "task", sortOrder: 2 },
    ], [{ fromNode: "step1", toNode: "step2", sortOrder: 1 }]);
    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, { id: instanceId, tenantId: tenant, name: "t", status: "active", version: 1, initialTaskName: "Review", definitionCode: def.code },
      { tenantId: tenant, actorId: submitter, messageId: instanceId });
    const [row] = await sqlAsTenant(tenant, sql`SELECT id FROM workflow.tasks WHERE instance_id = ${instanceId} AND status = 'pending' LIMIT 1`) as unknown as Array<{ id: string }>;
    await sqlAsTenant(tenant, sql`UPDATE workflow.tasks SET assignee_id = ${assignee} WHERE id = ${row!.id}`);
    return { q, tenant, taskId: row!.id };
  }

  /** Run the HTTP-side command and capture the completion it would queue. */
  async function issue(tenant: string, actor: string, taskId: string) {
    const published: Array<{ payload: unknown; messageId: string; correlationId: string }> = [];
    vi.spyOn(queue, "publish").mockImplementation(async (topic: string, msg: unknown) => {
      if (topic === COMMANDS.completeTask) published.push(msg as never);
      return randomUUID();
    });
    const ctx = { tenantId: tenant, actorId: actor, roles: ["manager"], correlationId: randomUUID(), sessionId: "s" } as RequestContext;
    await asTenant(tenant, () => completeTask(ctx, taskId, "approve"));
    vi.restoreAllMocks();
    expect(published).toHaveLength(1);
    return published[0]!;
  }

  const status = async (tenant: string, taskId: string) =>
    ((await sqlAsTenant(tenant, sql`SELECT status FROM workflow.tasks WHERE id = ${taskId}`)) as unknown as Array<{ status: string }>)[0]!.status;

  it("a task reassigned to someone else before the command applies is not completed; the refusal is audited", async () => {
    const a = randomUUID();
    const { q, tenant, taskId } = await setup(a);
    const msg = await issue(tenant, a, taskId);
    const b = randomUUID();
    await sqlAsTenant(tenant, sql`UPDATE workflow.tasks SET assignee_id = ${b} WHERE id = ${taskId}`); // reassignment in the window
    await q.deliver(COMMANDS.completeTask, msg.payload, { tenantId: tenant, actorId: a, messageId: msg.messageId });
    expect(await status(tenant, taskId)).toBe("pending");
    const hist = await sqlAsTenant(tenant, sql`SELECT action, detail FROM workflow.transition_history WHERE task_id = ${taskId}::uuid AND action = 'blocked'`) as unknown as Array<{ detail: Record<string, unknown> }>;
    expect(hist).toHaveLength(1);
    expect(hist[0]!.detail).toEqual({ reason: "assignee_changed_before_apply" });
    const audit = await sqlAsTenant(tenant, sql`SELECT actor_id::text AS actor_id, payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${taskId} AND payload->>'outcome' = 'denied'`) as unknown as Array<{ actor_id: string; payload: Record<string, unknown> }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]!).toMatchObject({ actor_id: a, payload: { action: "task.complete.denied", reason: "ASSIGNEE_CHANGED" } });
  });

  it("claim race: unassigned at check, claimed by someone else before apply -> refused", async () => {
    const a = randomUUID();
    const { q, tenant, taskId } = await setup(a);
    await sqlAsTenant(tenant, sql`UPDATE workflow.tasks SET assignee_id = NULL WHERE id = ${taskId}`);
    const msg = await issue(tenant, a, taskId);
    await sqlAsTenant(tenant, sql`UPDATE workflow.tasks SET assignee_id = ${randomUUID()} WHERE id = ${taskId}`);
    await q.deliver(COMMANDS.completeTask, msg.payload, { tenantId: tenant, actorId: a, messageId: msg.messageId });
    expect(await status(tenant, taskId)).toBe("pending");
    const hist = await sqlAsTenant(tenant, sql`SELECT detail FROM workflow.transition_history WHERE task_id = ${taskId}::uuid AND action = 'blocked'`) as unknown as Array<{ detail: Record<string, unknown> }>;
    expect(hist.map((h) => h.detail)).toEqual([{ reason: "assignee_changed_before_apply" }]);
  });

  it("reassigned TO the actor before apply -> still completes", async () => {
    const a = randomUUID();
    const { q, tenant, taskId } = await setup(a);
    await sqlAsTenant(tenant, sql`UPDATE workflow.tasks SET assignee_id = NULL WHERE id = ${taskId}`);
    const msg = await issue(tenant, a, taskId);
    await sqlAsTenant(tenant, sql`UPDATE workflow.tasks SET assignee_id = ${a} WHERE id = ${taskId}`); // the actor claimed it meanwhile
    await q.deliver(COMMANDS.completeTask, msg.payload, { tenantId: tenant, actorId: a, messageId: msg.messageId });
    expect(await status(tenant, taskId)).toBe("completed");
  });

  it("control: with no reassignment the same command completes the task", async () => {
    const a = randomUUID();
    const { q, tenant, taskId } = await setup(a);
    const msg = await issue(tenant, a, taskId);
    await q.deliver(COMMANDS.completeTask, msg.payload, { tenantId: tenant, actorId: a, messageId: msg.messageId });
    expect(await status(tenant, taskId)).toBe("completed");
  });
});

describe("a delegate's authority is re-verified under the lock (delta review item 3)", () => {
  /** A role-less task assigned to `delegator`; `delegate` acts through an active delegation. */
  async function setupDelegated() {
    const q = new TestQueue();
    registerInstancesConsumers(q);
    registerTasksConsumers(q);
    const tenant = newTenant();
    const submitter = randomUUID(), delegator = randomUUID(), delegate = randomUUID();
    const def = await seedDefinition(tenant, [
      { nodeKey: "step1", name: "Review", nodeType: "task", sortOrder: 1 },
      { nodeKey: "step2", name: "Approve", nodeType: "task", sortOrder: 2 },
    ], [{ fromNode: "step1", toNode: "step2", sortOrder: 1 }]);
    const instanceId = randomUUID();
    await q.deliver(COMMANDS.createInstance, { id: instanceId, tenantId: tenant, name: "t", status: "active", version: 1, initialTaskName: "Review", definitionCode: def.code },
      { tenantId: tenant, actorId: submitter, messageId: instanceId });
    const [row] = await sqlAsTenant(tenant, sql`SELECT id FROM workflow.tasks WHERE instance_id = ${instanceId} AND status = 'pending' LIMIT 1`) as unknown as Array<{ id: string }>;
    await sqlAsTenant(tenant, sql`UPDATE workflow.tasks SET assignee_id = ${delegator} WHERE id = ${row!.id}`);
    const delegationId = randomUUID();
    await sqlAsTenant(tenant, sql`
      INSERT INTO workflow.workflow_delegations (id, tenant_id, delegator_id, delegate_id, from_date, to_date, roles, is_active)
      VALUES (${delegationId}, ${tenant}, ${delegator}, ${delegate}, (now() - interval '2 days')::date, (now() + interval '2 days')::date, ARRAY[]::text[], true)`);
    return { q, tenant, taskId: row!.id, delegate, delegationId };
  }

  async function issueAs(tenant: string, actor: string, taskId: string) {
    const published: Array<{ payload: { authz?: { assigneeDelegationIds?: string[] } }; messageId: string }> = [];
    vi.spyOn(queue, "publish").mockImplementation(async (topic: string, msg: unknown) => {
      if (topic === COMMANDS.completeTask) published.push(msg as never);
      return randomUUID();
    });
    const ctx = { tenantId: tenant, actorId: actor, roles: ["workflow_user"], correlationId: randomUUID(), sessionId: "s" } as RequestContext;
    await asTenant(tenant, () => completeTask(ctx, taskId, "approve"));
    vi.restoreAllMocks();
    expect(published).toHaveLength(1);
    return published[0]!;
  }

  const taskStatus = async (tenant: string, taskId: string) =>
    ((await sqlAsTenant(tenant, sql`SELECT status FROM workflow.tasks WHERE id = ${taskId}`)) as unknown as Array<{ status: string }>)[0]!.status;
  const blocked = async (tenant: string, taskId: string) =>
    ((await sqlAsTenant(tenant, sql`SELECT detail FROM workflow.transition_history WHERE task_id = ${taskId}::uuid AND action = 'blocked'`)) as unknown as Array<{ detail: Record<string, unknown> }>).map((h) => h.detail);

  it.each([
    ["revoked", sql`is_active = false`],
    ["expired", sql`to_date = (now() - interval '1 day')::date`],
  ])("a delegation %s between the check and apply -> the delegate's completion is refused and audited", async (_label, change) => {
    const { q, tenant, taskId, delegate, delegationId } = await setupDelegated();
    const msg = await issueAs(tenant, delegate, taskId);
    expect(msg.payload.authz?.assigneeDelegationIds).toEqual([delegationId]);
    await sqlAsTenant(tenant, sql`UPDATE workflow.workflow_delegations SET ${change} WHERE id = ${delegationId}`);
    await q.deliver(COMMANDS.completeTask, msg.payload, { tenantId: tenant, actorId: delegate, messageId: msg.messageId });
    expect(await taskStatus(tenant, taskId)).toBe("pending");
    expect(await blocked(tenant, taskId)).toEqual([{ reason: "delegation_no_longer_active" }]);
    const audit = await sqlAsTenant(tenant, sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${taskId} AND payload->>'outcome' = 'denied'`) as unknown as Array<{ payload: Record<string, unknown> }>;
    expect(audit.map((a) => a.payload.reason)).toEqual(["DELEGATION_NOT_ACTIVE"]);
  });

  it("control: the delegation still active -> the delegate's completion applies", async () => {
    const { q, tenant, taskId, delegate } = await setupDelegated();
    const msg = await issueAs(tenant, delegate, taskId);
    await q.deliver(COMMANDS.completeTask, msg.payload, { tenantId: tenant, actorId: delegate, messageId: msg.messageId });
    expect(await taskStatus(tenant, taskId)).toBe("completed");
  });
});
