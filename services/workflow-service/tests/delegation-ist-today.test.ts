/**
 * Delegation validity uses the IST (Asia/Kolkata) calendar date, matching the UI.
 * Between 00:00 and 05:30 IST the UTC date is still "yesterday", which used to
 * make a delegation starting today look inactive and one ending yesterday look
 * active. Only Date is faked so the real-DB driver keeps its timers.
 */
import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from "vitest";

const identity = vi.hoisted(() => ({ roles: new Map<string, string[] | undefined>() }));
vi.mock("../src/shared/identity-client.js", () => ({
  fetchUserRoleKeys: async (_t: string, userId: string) => identity.roles.get(userId),
}));
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { sqlClient } from "../src/shared/db.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import * as delegationRepo from "../src/modules/delegations/repo.js";
import { completeTask } from "../src/modules/tasks/commands.js";
import { istDateKey, todayIST } from "../src/shared/dates.js";
import { COMMANDS } from "../src/topics.js";
import { TestQueue, seedDefinition, cleanup, sqlAsTenant, asTenant } from "./helpers/engine-harness.js";

const ROLE = "estab_deputy_secretary";
const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }
beforeEach(() => identity.roles.clear());
afterEach(async () => {
  vi.useRealTimers();
  if (tenants.length) { await cleanup(...tenants); tenants.length = 0; }
});
afterAll(async () => { await sqlClient.end(); });

const ctxFor = (tenantId: string, actorId: string, roles: string[]): RequestContext =>
  ({ tenantId, actorId, roles, correlationId: randomUUID(), sessionId: "s1" }) as RequestContext;

/** Freeze the clock (Date only) at an instant. */
function freeze(iso: string): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

async function setupTask(tenantId: string): Promise<string> {
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
  }, { tenantId, actorId: randomUUID(), messageId: instanceId });
  const rows = await sqlAsTenant(tenantId,
    sql`SELECT id FROM workflow.tasks WHERE instance_id = ${instanceId} AND status = 'pending' LIMIT 1`,
  ) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

async function delegate(tenantId: string, delegatorId: string, delegateId: string, fromDate: string, toDate: string | null, roles = [ROLE]) {
  await asTenant(tenantId, () => delegationRepo.create({ tenantId, delegatorId, delegateId, roles, fromDate, toDate, reason: null }));
}

describe("istDateKey / todayIST", () => {
  it("rolls to the next calendar day at 18:30 UTC (00:00 IST), not at 00:00 UTC", () => {
    expect(istDateKey(new Date("2026-10-23T18:29:59.999Z"))).toBe("2026-10-23");
    expect(istDateKey(new Date("2026-10-23T18:30:00.000Z"))).toBe("2026-10-24");
    expect(istDateKey(new Date("2026-10-23T23:59:59.000Z"))).toBe("2026-10-24");
    expect(istDateKey(new Date("2026-10-24T00:00:00.000Z"))).toBe("2026-10-24");
    expect(istDateKey(new Date("2026-12-31T18:30:00.000Z"))).toBe("2027-01-01");
  });

  it("todayIST follows the faked clock", () => {
    freeze("2026-10-23T20:00:00Z"); // 01:30 IST on the 24th; UTC date is still the 23rd
    expect(todayIST()).toBe("2026-10-24");
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-10-23");
  });
});

describe("delegation validity at the 00:00-05:30 IST boundary", () => {
  it("activeForDelegate: a delegation starting today (IST) is active at 01:30 IST", async () => {
    const tenantId = newTenant(); const delegateId = randomUUID();
    await delegate(tenantId, randomUUID(), delegateId, "2026-10-24", "2026-10-30");
    freeze("2026-10-23T20:00:00Z"); // 01:30 IST 24 Oct
    const active = await asTenant(tenantId, () => delegationRepo.activeForDelegate(tenantId, delegateId, todayIST()));
    expect(active).toHaveLength(1);
  });

  it("activeForDelegate: a delegation that ended yesterday (IST) is NOT active at 01:30 IST", async () => {
    const tenantId = newTenant(); const delegateId = randomUUID();
    await delegate(tenantId, randomUUID(), delegateId, "2026-10-01", "2026-10-23");
    freeze("2026-10-23T20:00:00Z"); // 01:30 IST 24 Oct
    const active = await asTenant(tenantId, () => delegationRepo.activeForDelegate(tenantId, delegateId, todayIST()));
    expect(active).toHaveLength(0);
  });

  it("completeTask (use-time check): starts-today delegation works at 01:30 IST, ends-yesterday one is refused", async () => {
    const tenantId = newTenant();
    const starting = randomUUID(); const ended = randomUUID();
    const delegatorA = randomUUID(); const delegatorB = randomUUID();
    identity.roles.set(delegatorA, [ROLE]); identity.roles.set(delegatorB, [ROLE]);
    await delegate(tenantId, delegatorA, starting, "2026-10-24", "2026-10-30");
    await delegate(tenantId, delegatorB, ended, "2026-10-01", "2026-10-23");
    freeze("2026-10-23T20:00:00Z"); // 01:30 IST 24 Oct
    const taskId = await setupTask(tenantId);
    await expect(asTenant(tenantId, () => completeTask(ctxFor(tenantId, ended, ["workflow_user"]), taskId, "approve")))
      .rejects.toMatchObject({ status: 403, code: "ROLE_NOT_AUTHORIZED" });
    const res = await asTenant(tenantId, () => completeTask(ctxFor(tenantId, starting, ["workflow_user"]), taskId, "approve"));
    expect(res.status).toBe("accepted");
  });

  it("completeTask: after 05:30 IST (same UTC date as IST) the same delegation behaves identically", async () => {
    const tenantId = newTenant(); const delegateId = randomUUID(); const delegator = randomUUID();
    identity.roles.set(delegator, [ROLE]);
    await delegate(tenantId, delegator, delegateId, "2026-10-24", "2026-10-30");
    freeze("2026-10-24T06:00:00Z"); // 11:30 IST 24 Oct
    const taskId = await setupTask(tenantId);
    const res = await asTenant(tenantId, () => completeTask(ctxFor(tenantId, delegateId, ["workflow_user"]), taskId, "approve"));
    expect(res.status).toBe("accepted");
  });

  it("listLegacy: an expired legacy delegation drops out at 00:00 IST, not at 00:00 UTC", async () => {
    const tenantId = newTenant();
    await delegate(tenantId, randomUUID(), randomUUID(), "2026-10-01", "2026-10-23", []);
    freeze("2026-10-23T17:00:00Z"); // 22:30 IST 23 Oct: still running
    expect((await asTenant(tenantId, () => delegationRepo.listLegacy(tenantId, 50, 0))).total).toBe(1);
    freeze("2026-10-23T20:00:00Z"); // 01:30 IST 24 Oct: ended
    expect((await asTenant(tenantId, () => delegationRepo.listLegacy(tenantId, 50, 0))).total).toBe(0);
  });
});
