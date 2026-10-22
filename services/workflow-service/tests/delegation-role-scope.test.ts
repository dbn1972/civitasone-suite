/**
 * Security: a delegation may satisfy a task's role gate only when it explicitly
 * conveys that role, and a delegator can only convey roles they hold.
 * Before the fix ANY active delegation naming the actor passed the role gate, so
 * two cooperating plain workflow_users could complete a task needing e.g.
 * estab_deputy_secretary. Real-DB tests (disposable Postgres).
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import * as delegationRepo from "../src/modules/delegations/repo.js";
import { completeTask, claimTask } from "../src/modules/tasks/commands.js";
import { COMMANDS } from "../src/topics.js";
import { TestQueue, seedDefinition, cleanup, sqlAsTenant, asTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ROLE = "estab_deputy_secretary";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }
afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

const ctxFor = (tenantId: string, actorId: string, roles: string[]): RequestContext =>
  ({ tenantId, actorId, roles, correlationId: randomUUID(), sessionId: "s1" }) as RequestContext;

async function setupTask(tenantId: string, submitter: string): Promise<string> {
  const q = new TestQueue();
  registerInstancesConsumers(q);
  registerTasksConsumers(q);
  const def = await seedDefinition(tenantId, [
    { nodeKey: "step1", name: "Review", roleRef: ROLE, nodeType: "task", sortOrder: 1 },
    { nodeKey: "step2", name: "Approve", nodeType: "task", sortOrder: 2 },
  ], [{ fromNode: "step1", toNode: "step2", sortOrder: 1 }]);
  const instanceId = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id: instanceId, tenantId, name: "t", status: "active", version: 1,
    initialTaskName: "Review", definitionCode: def.code,
  }, { tenantId, actorId: submitter, messageId: instanceId });
  const rows = await sqlAsTenant(tenantId,
    sql`SELECT id FROM workflow.tasks WHERE instance_id = ${instanceId} AND status = 'pending' LIMIT 1`,
  ) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

async function delegate(tenantId: string, delegatorId: string, delegateId: string, roles: string[]): Promise<void> {
  await asTenant(tenantId, () => delegationRepo.create({
    tenantId, delegatorId, delegateId, roles,
    fromDate: "2020-01-01", toDate: null, reason: null,
  }));
}

describe("delegation role scope: task gate", () => {
  it("a delegation conveying NO role (legacy / empty scope) does not satisfy the gate", async () => {
    const tenantId = newTenant();
    const taskId = await setupTask(tenantId, randomUUID());
    const delegator = randomUUID(); const delegateId = randomUUID();
    await delegate(tenantId, delegator, delegateId, []);
    await expect(asTenant(tenantId, () => completeTask(ctxFor(tenantId, delegateId, ["workflow_user"]), taskId, "approve")))
      .rejects.toMatchObject({ status: 403, code: "ROLE_NOT_AUTHORIZED" });
    await expect(asTenant(tenantId, () => claimTask(ctxFor(tenantId, delegateId, ["workflow_user"]), taskId)))
      .rejects.toMatchObject({ status: 403, code: "ROLE_NOT_AUTHORIZED" });
  });

  it("a delegation for a DIFFERENT role does not satisfy the gate", async () => {
    const tenantId = newTenant();
    const taskId = await setupTask(tenantId, randomUUID());
    const delegator = randomUUID(); const delegateId = randomUUID();
    await delegate(tenantId, delegator, delegateId, ["workflow_user"]);
    await expect(asTenant(tenantId, () => completeTask(ctxFor(tenantId, delegateId, ["workflow_user"]), taskId, "approve")))
      .rejects.toMatchObject({ status: 403, code: "ROLE_NOT_AUTHORIZED" });
  });

  it("a delegation from a role holder that conveys the task role satisfies the gate", async () => {
    const tenantId = newTenant();
    const taskId = await setupTask(tenantId, randomUUID());
    const delegator = randomUUID(); const delegateId = randomUUID();
    await delegate(tenantId, delegator, delegateId, [ROLE]);
    const res = await asTenant(tenantId, () => completeTask(ctxFor(tenantId, delegateId, ["workflow_user"]), taskId, "approve"));
    expect(res.status).toBe("accepted");
  });

  it("a conveying delegation for ANOTHER delegate does not help the actor", async () => {
    const tenantId = newTenant();
    const taskId = await setupTask(tenantId, randomUUID());
    await delegate(tenantId, randomUUID(), randomUUID(), [ROLE]);
    await expect(asTenant(tenantId, () => completeTask(ctxFor(tenantId, randomUUID(), ["workflow_user"]), taskId, "approve")))
      .rejects.toMatchObject({ status: 403, code: "ROLE_NOT_AUTHORIZED" });
  });

  it("SoD still applies: a conveying delegation from the submitter is a self-approval", async () => {
    const tenantId = newTenant();
    const submitter = randomUUID();
    const taskId = await setupTask(tenantId, submitter);
    const delegateId = randomUUID();
    await delegate(tenantId, submitter, delegateId, [ROLE]);
    await expect(asTenant(tenantId, () => completeTask(ctxFor(tenantId, delegateId, ["workflow_user"]), taskId, "approve")))
      .rejects.toMatchObject({ status: 403, code: "SELF_APPROVAL_DENIED" });
  });
});

describe("delegation role scope: creation", () => {
  const tok = (sub: string, tid: string, roles: string[]) => signToken({ sub, tid, roles, sid: "s" }, SECRET);

  it("rejects (403) a delegation whose role the delegator does not hold, and stores nothing", async () => {
    const tenantId = newTenant();
    const actor = randomUUID();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/workflow/delegations",
      headers: { authorization: `Bearer ${tok(actor, tenantId, ["workflow_user"])}` },
      payload: { delegateId: randomUUID(), roles: [ROLE], fromDate: "2025-01-01" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("DELEGATION_ROLE_NOT_HELD");
    const rows = await sqlAsTenant(tenantId, sql`SELECT 1 FROM workflow.workflow_delegations WHERE tenant_id = ${tenantId}`);
    expect(rows).toHaveLength(0);
  });

  it("rejects (400) a delegation with no role scope", async () => {
    const tenantId = newTenant();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/workflow/delegations",
      headers: { authorization: `Bearer ${tok(randomUUID(), tenantId, ["workflow_user"])}` },
      payload: { delegateId: randomUUID(), fromDate: "2025-01-01" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("rejects when only SOME of the requested roles are held", async () => {
    const tenantId = newTenant();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/workflow/delegations",
      headers: { authorization: `Bearer ${tok(randomUUID(), tenantId, ["workflow_user", "workflow_admin"])}` },
      payload: { delegateId: randomUUID(), roles: ["workflow_user", ROLE], fromDate: "2025-01-01" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
