/**
 * B9-wf1 (review): the procurement half of plan / PO amendment approval via
 * the workflow task, and the converge-back on a direct decision.
 *
 *  - workflow-service dispatches procurement.plan.{approve,reject} with
 *    `{ id }` and procurement.po_amendment.{approve,reject} with
 *    `{ amendmentId }` only (no poId) when the task is completed. These
 *    tests deliver exactly that payload; the amendment's PO is resolved from
 *    the tenant-scoped amendment row.
 *  - every plan / amendment decision (direct route or task) enqueues
 *    workflow.instance.close_by_ref, so a direct decision closes the open task.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { randomUUID } from "node:crypto";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { procurementPlans } from "../src/modules/planning/schema.js";
import { procurementPos, procurementPoAmendments } from "../src/modules/po/schema.js";
import { registerPlanningConsumers } from "../src/modules/planning/consumer.js";
import { registerPoAmendmentConsumers } from "../src/modules/po/amendment-consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "7c7c7c7c-b9b9-4000-8000-0000000000b9";
const MAKER = randomUUID();
const CHECKER = randomUUID();
const CLOSE = "workflow.instance.close_by_ref";

function msg(type: string, payload: Record<string, unknown>, actorId = CHECKER) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: `corr-${type}`, schemaVersion: "1.0", payload };
}
function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
async function deliver(type: string, payload: Record<string, unknown>): Promise<void> {
  const q = wire(new MemoryQueue());
  registerPlanningConsumers(q);
  registerPoAmendmentConsumers(q);
  await q.start();
  await q.publish(type, msg(type, payload));
  await new Promise<void>((r) => setTimeout(r, 400));
  await q.stop();
}
const inTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

async function seedPendingPlan(): Promise<string> {
  const id = randomUUID();
  await inTenant((tx) => tx.insert(procurementPlans).values({
    id, tenantId: TENANT, planNo: `APP/B9/${id.slice(-4)}`, planYear: 2026, title: "B9", department: "Stores",
    status: "pending", submittedBy: MAKER, submittedAt: new Date(), createdBy: MAKER, updatedBy: MAKER,
  }));
  return id;
}
async function seedPendingAmendment(): Promise<{ poId: string; amendmentId: string }> {
  const poId = randomUUID();
  const amendmentId = randomUUID();
  await inTenant(async (tx) => {
    await tx.insert(procurementPos).values({
      id: poId, tenantId: TENANT, poNo: `PO-B9-${poId.slice(-4)}`, vendorId: randomUUID(), indentRef: "procurement_indent:seed",
      totalMinor: 1_000_000n, currency: "INR", status: "approved", createdBy: MAKER, updatedBy: MAKER,
    });
    await tx.insert(procurementPoAmendments).values({
      id: amendmentId, poId, tenantId: TENANT, amendmentNo: 1, amendmentType: "change_order", status: "pending",
      reason: "B9 scope", deltaMinor: 250_000n, prevTotalMinor: 1_000_000n, newTotalMinor: 1_250_000n, currency: "INR",
      requestedBy: MAKER, createdBy: MAKER, updatedBy: MAKER,
    });
  });
  return { poId, amendmentId };
}
async function closeMessages(refId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await inTenant((tx) => tx.select().from(outboxMessages)
    .where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, CLOSE))));
  return rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>)
    .filter((p) => p.refId === refId);
}
const plan = async (id: string) => (await inTenant((tx) => tx.select().from(procurementPlans).where(eq(procurementPlans.id, id))))[0];
const amendment = async (id: string) => (await inTenant((tx) => tx.select().from(procurementPoAmendments).where(eq(procurementPoAmendments.id, id))))[0];
const po = async (id: string) => (await inTenant((tx) => tx.select().from(procurementPos).where(eq(procurementPos.id, id))))[0];

async function wipe(): Promise<void> {
  await inTenant(async (tx) => {
    await tx.delete(procurementPoAmendments).where(eq(procurementPoAmendments.tenantId, TENANT));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
    await tx.delete(procurementPlans).where(eq(procurementPlans.tenantId, TENANT));
  });
}
beforeAll(async () => { await wipe(); });
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("B9-wf1 — workflow task decisions reach the procurement record", () => {
  it("plan: the task-approve dispatch approves the plan and asks workflow to close its approval", async () => {
    const id = await seedPendingPlan();
    await deliver(COMMANDS.planApprove, { id, tenantId: TENANT, approvedBy: CHECKER });
    expect((await plan(id))?.status).toBe("approved");
    expect(await closeMessages(id)).toEqual([{ tenantId: TENANT, refType: "procurement_plan", refId: id, decision: "approve" }]);
  });

  it("plan: the task-reject dispatch rejects the plan with the approver's reason", async () => {
    const id = await seedPendingPlan();
    await deliver(COMMANDS.planReject, { id, tenantId: TENANT, rejectedBy: CHECKER, reason: "over budget" });
    const row = await plan(id);
    expect(row?.status).toBe("rejected");
    expect(row?.rejectedReason).toBe("over budget");
    expect(await closeMessages(id)).toEqual([{ tenantId: TENANT, refType: "procurement_plan", refId: id, decision: "reject", reason: "over budget" }]);
  });

  it("amendment: the task-approve dispatch (amendmentId only, no poId) approves it and updates the PO total", async () => {
    const { poId, amendmentId } = await seedPendingAmendment();
    await deliver(COMMANDS.poAmendmentApprove, { amendmentId, tenantId: TENANT, approvedBy: CHECKER });
    expect((await amendment(amendmentId))?.status).toBe("approved");
    expect((await po(poId))?.totalMinor).toBe(1_250_000n);
    expect(await closeMessages(amendmentId)).toEqual([{ tenantId: TENANT, refType: "procurement_po_amendment", refId: amendmentId, decision: "approve" }]);
  });

  it("amendment: the task-reject dispatch (amendmentId only) rejects it; the PO total is unchanged", async () => {
    const { poId, amendmentId } = await seedPendingAmendment();
    await deliver(COMMANDS.poAmendmentReject, { amendmentId, tenantId: TENANT, rejectedBy: CHECKER, reason: "not justified" });
    const row = await amendment(amendmentId);
    expect(row?.status).toBe("rejected");
    expect(row?.rejectedReason).toBe("not justified");
    expect((await po(poId))?.totalMinor).toBe(1_000_000n);
    expect(await closeMessages(amendmentId)).toEqual([{ tenantId: TENANT, refType: "procurement_po_amendment", refId: amendmentId, decision: "reject", reason: "not justified" }]);
  });

  it("amendment: a direct approve (route payload with poId) still works and also closes the workflow approval", async () => {
    const { poId, amendmentId } = await seedPendingAmendment();
    await deliver(COMMANDS.poAmendmentApprove, { poId, amendmentId, tenantId: TENANT });
    expect((await amendment(amendmentId))?.status).toBe("approved");
    expect(await closeMessages(amendmentId)).toHaveLength(1);
  });

  it("amendment: a poId that does not match the amendment is still refused", async () => {
    const { amendmentId } = await seedPendingAmendment();
    await deliver(COMMANDS.poAmendmentApprove, { poId: randomUUID(), amendmentId, tenantId: TENANT });
    expect((await amendment(amendmentId))?.status).toBe("pending");
    expect(await closeMessages(amendmentId)).toHaveLength(0);
  });
});
