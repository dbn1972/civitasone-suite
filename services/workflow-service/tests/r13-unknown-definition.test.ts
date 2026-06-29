/**
 * R13 — a from-module raise whose approval chain doesn't resolve to a seeded
 * workflow definition must be REJECTED, not silently turned into a single
 * ad-hoc task that one approval can rubber-stamp (bypassing SO→US→DS).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db, sqlClient } from "../src/shared/db.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { TestQueue, seedDefinition, cleanup, getInstance, tasksFor, historyActions } from "./helpers/engine-harness.js";

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

async function createInstance(tenantId: string, definitionCode: string | undefined, actorId: string): Promise<string> {
  const id = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id, tenantId, name: "Sanction approval (from finance)", status: "active", version: 1,
    initialTaskName: "Start", ...(definitionCode ? { definitionCode } : {}),
    refType: "estab_file", refId: randomUUID(),
  }, { tenantId, actorId, messageId: id });
  return id;
}

describe("R13 — unknown approval-chain definition is rejected (no rubber-stamp)", () => {
  it("rejects the instance and creates NO approval task when the definition code does not resolve", async () => {
    const tenant = newTenant();
    const id = await createInstance(tenant, "nonexistent_eoffice_chain", randomUUID());

    const inst = await getInstance(id);
    expect(inst?.status).toBe("rejected");
    expect(inst?.definition_id).toBeNull();
    expect(inst?.current_node).toBeNull();

    // The crucial guarantee: no actionable task exists to one-click approve.
    const ts = await tasksFor(id);
    expect(ts).toHaveLength(0);

    const actions = await historyActions(id);
    expect(actions).toContain("rejected");
  });

  it("still drives a real instance when the definition DOES resolve", async () => {
    const tenant = newTenant();
    const def = await seedDefinition(tenant, [
      { nodeKey: "start", name: "Submit", nodeType: "start", sortOrder: 1 },
      { nodeKey: "review", name: "Review", roleRef: "reviewer", sortOrder: 2 },
      { nodeKey: "end", name: "Done", nodeType: "end", sortOrder: 3 },
    ], [
      { fromNode: "start", toNode: "review" },
      { fromNode: "review", toNode: "end" },
    ]);
    const id = await createInstance(tenant, def.code, randomUUID());

    const inst = await getInstance(id);
    expect(inst?.status).toBe("active");
    expect(inst?.definition_id).toBe(def.id);
    const ts = await tasksFor(id);
    expect(ts).toHaveLength(1);
  });
});
