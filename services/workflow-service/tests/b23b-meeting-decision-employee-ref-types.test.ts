/**
 * B23b item 2: meeting-service raises workflow.instance.create with refType "meeting_decision" (financial
 * counter-signature, GFR) and hrms-service with refType "employee" (onboarding). The 0024/0048 ref_type CHECK
 * allowed neither, so every such command dead-lettered (3 rows in workflow.dead_letters for the Sundarpur
 * Municipal Corporation sign-off tenant). Real DB, run as the service role (non-superuser, NOBYPASSRLS).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sqlClient, db } from "../src/shared/db.js";
import { registerProvisioningConsumers } from "../src/modules/provisioning/consumer.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { STANDARD_DEFINITIONS } from "../src/modules/provisioning/catalog.js";
import { COMMANDS, CONSUMED_EVENTS } from "../src/topics.js";
import { TestQueue, cleanup, getInstance, tasksFor } from "./helpers/engine-harness.js";

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

async function provision(tenantId: string): Promise<void> {
  await q.deliver(CONSUMED_EVENTS.tenantCreated, { tenantId }, { tenantId, actorId: randomUUID() });
}

/** Exactly what meeting-service/decision/consumer.ts publishes (values from the dead-lettered envelope). */
async function raiseMeetingDecision(tenantId: string, decisionId: string): Promise<string> {
  const id = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id, tenantId, name: `Financial counter-signature — decision ${decisionId}`, status: "active", version: 1,
    initialTaskName: "Counter-signature", definitionCode: "meeting_financial_countersignature",
    refType: "meeting_decision", refId: decisionId,
    context: { meetingId: randomUUID(), decisionType: "project", financialImplication: "486000000", currency: "INR", authority: "Resolved by the Finance & Works Committee" },
  }, { tenantId, actorId: randomUUID(), messageId: id });
  return id;
}

describe("B23b-wf — meeting_decision / employee ref types", () => {
  it("the test DB role is a non-superuser that does not bypass RLS", async () => {
    const r = (await db.execute(sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)) as unknown as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;
    expect(r[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("the catalogue carries a one-node Counter-signature chain for the financial authority (finance_admin)", () => {
    const d = STANDARD_DEFINITIONS.find((x) => x.code === "meeting_financial_countersignature");
    expect(d).toBeDefined();
    expect(d!.cluster).toBe("finance");
    expect(d!.nodes).toEqual([{ nodeKey: "countersign", name: "Counter-signature", roleRef: "finance_admin" }]);
  });

  it("a meeting_decision instance in a provisioned tenant becomes active with a pending Counter-signature task", async () => {
    const tenant = newTenant();
    await provision(tenant);
    const decisionId = randomUUID();
    const id = await raiseMeetingDecision(tenant, decisionId);
    expect((await getInstance(tenant, id))?.status).toBe("active");
    const ts = await tasksFor(tenant, id);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ node_key: "countersign", role_ref: "finance_admin", ref_type: "meeting_decision", ref_id: decisionId, status: "pending" });
  });

  it("a meeting_decision instance in a tenant without the chain is rejected (WORKFLOW_NOT_CONFIGURED), not dead-lettered", async () => {
    const tenant = newTenant();
    const id = await raiseMeetingDecision(tenant, randomUUID());
    expect((await getInstance(tenant, id))?.status).toBe("rejected");
    expect(await tasksFor(tenant, id)).toHaveLength(0);
  });

  it("an employee (onboarding) instance is accepted by the CHECK; with no employee_onboarding definition it is rejected, not dead-lettered", async () => {
    const tenant = newTenant();
    await provision(tenant);
    const id = randomUUID();
    await q.deliver(COMMANDS.createInstance, {
      id, tenantId: tenant, name: "Employee Onboarding — 3f9a1c2e", status: "active", version: 1,
      definitionCode: "employee_onboarding", initialTaskName: "Document Submission", refType: "employee", refId: randomUUID(),
    }, { tenantId: tenant, actorId: randomUUID(), messageId: id });
    expect((await getInstance(tenant, id))?.status).toBe("rejected");
  });

  it("every refType a publisher sends is accepted by the CHECK (instances and tasks)", async () => {
    const tenant = newTenant();
    const refTypes = ["leave_app", "payroll_run", "procurement_indent", "procurement_po", "estab_file", "asset_disposal",
      "procurement_plan", "procurement_po_amendment", "meeting_decision", "employee"];
    for (const rt of refTypes) {
      const id = randomUUID();
      await q.deliver(COMMANDS.createInstance, {
        id, tenantId: tenant, name: `ref ${rt}`, status: "active", version: 1, definitionCode: "no_such_definition",
        initialTaskName: "x", refType: rt, refId: randomUUID(),
      }, { tenantId: tenant, actorId: randomUUID(), messageId: id });
      // rejected (unknown definition) = the INSERT passed the CHECK; a CHECK violation would throw and leave no row.
      expect((await getInstance(tenant, id))?.status, rt).toBe("rejected");
    }
  });
});
