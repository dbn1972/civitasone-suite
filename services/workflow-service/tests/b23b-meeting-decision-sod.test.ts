/**
 * B23b: the GFR financial counter-signature of a meeting decision (refType meeting_decision) is strict
 * maker/checker: the person who recorded the decision (instance initiator) can never counter-sign it, even as
 * super_admin (sod_override). No downstream handler enforces this, so workflow does. Real DB, NOBYPASSRLS role.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { registerProvisioningConsumers } from "../src/modules/provisioning/consumer.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { isStrictSodRefType } from "../src/modules/tasks/sod.js";
import { COMMANDS, CONSUMED_EVENTS } from "../src/topics.js";
import { TestQueue, cleanup, getInstance, tasksFor } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET as string;
const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

let q: TestQueue;
beforeAll(() => {
  q = new TestQueue();
  registerProvisioningConsumers(q);
  registerInstancesConsumers(q);
  registerTasksConsumers(q);
});
afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

/** What meeting-service publishes; `recorder` is the actor who recorded the decision. */
async function raise(tenantId: string, recorder: string): Promise<string> {
  await q.deliver(CONSUMED_EVENTS.tenantCreated, { tenantId }, { tenantId, actorId: randomUUID() });
  const id = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id, tenantId, name: "Financial counter-signature", status: "active", version: 1,
    initialTaskName: "Counter-signature", definitionCode: "meeting_financial_countersignature",
    refType: "meeting_decision", refId: randomUUID(),
    context: { financialImplication: "486000000", currency: "INR" },
  }, { tenantId, actorId: recorder, messageId: id });
  return id;
}

describe("meeting_decision counter-signature is strict SoD", () => {
  it("is a strict-SoD refType", () => {
    expect(isStrictSodRefType("meeting_decision")).toBe(true);
  });

  it("the recorder, even as super_admin, gets 403 SOD_SELF_APPROVAL; the task stays open", async () => {
    const tenant = newTenant();
    const recorder = randomUUID();
    const id = await raise(tenant, recorder);
    const task = (await tasksFor(tenant, id))[0]!;
    const tok = signToken({ sub: recorder, tid: tenant, roles: ["super_admin", "finance_admin"], sid: "s" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/workflow/tasks/${task.id}/complete`,
      headers: { authorization: `Bearer ${tok}` }, payload: { decision: "approve" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SOD_SELF_APPROVAL");
    expect((await tasksFor(tenant, id))[0]).toMatchObject({ status: "pending" });
    expect((await getInstance(tenant, id))?.status).toBe("active");
  });

  it("a completeTask command by the recorder carrying sodOverride is refused in the consumer", async () => {
    const tenant = newTenant();
    const recorder = randomUUID();
    const id = await raise(tenant, recorder);
    const t = (await tasksFor(tenant, id))[0]!;
    await q.deliver(COMMANDS.completeTask, {
      id: t.id, tenantId: tenant, instanceId: id, name: t.name, status: "pending", roleRef: t.role_ref,
      nodeKey: t.node_key, refType: t.ref_type, refId: t.ref_id, decision: "approve", sodOverride: true,
    }, { tenantId: tenant, actorId: recorder, messageId: randomUUID() });
    expect((await tasksFor(tenant, id))[0]).toMatchObject({ status: "pending" });
    expect((await getInstance(tenant, id))?.status).toBe("active");
  });

  it("a different finance_admin can counter-sign", async () => {
    const tenant = newTenant();
    const id = await raise(tenant, randomUUID());
    const t = (await tasksFor(tenant, id))[0]!;
    await q.deliver(COMMANDS.completeTask, {
      id: t.id, tenantId: tenant, instanceId: id, name: t.name, status: "pending", roleRef: t.role_ref,
      nodeKey: t.node_key, refType: t.ref_type, refId: t.ref_id, decision: "approve",
    }, { tenantId: tenant, actorId: randomUUID(), messageId: randomUUID() });
    expect((await getInstance(tenant, id))?.status).toBe("completed");
  });
});
