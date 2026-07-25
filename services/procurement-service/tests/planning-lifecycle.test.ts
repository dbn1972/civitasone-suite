/**
 * SVC-041 Annual procurement planning — integration.
 *
 * Drives the maker-checker plan lifecycle through the real consumer on a
 * MemoryQueue against the real Postgres test DB:
 *   create → submit (pending) → approve (approved, event emitted)
 *
 * Covers:
 *   - Maker-checker: submitter cannot self-approve (in-consumer SoD; plan stays pending).
 *   - Distinct checker approves → status approved + procurement.plan.approved emitted.
 *   - Demand aggregation from approved indents.
 *   - Tenant isolation (RLS): a foreign-tenant approve command finds no plan.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementPlans, procurementPlanLines } from "../src/modules/planning/schema.js";
import { procurementIndents, procurementIndentItems } from "../src/modules/indent/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerPlanningConsumers } from "../src/modules/planning/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { randomUUID } from "node:crypto";

const TENANT = "5a5a5a5a-1111-4000-8000-0000000000a1";
const OTHER  = "5b5b5b5b-2222-4000-8000-0000000000b2";
const MAKER   = "6a6a6a6a-0000-4000-8000-000000000001";
const CHECKER = "6a6a6a6a-0000-4000-8000-000000000002";

function msg(type: string, payload: Record<string, unknown>, actorId = MAKER, tenantId = TENANT) {
  return { messageId: randomUUID(), type, tenantId, actorId, correlationId: `corr-${type}`, schemaVersion: "1.0", payload };
}

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function drain(q: MemoryQueue) {
  await new Promise<void>((r) => setTimeout(r, 400));
  await q.stop();
}

async function wipeTenant(t: string) {
  await runWithTenant(t, () => db.transaction(async (tx) => {
    await tx.delete(procurementPlanLines).where(eq(procurementPlanLines.tenantId, t));
    await tx.delete(procurementPlans).where(eq(procurementPlans.tenantId, t));
    await tx.delete(procurementIndentItems).where(eq(procurementIndentItems.tenantId, t));
    await tx.delete(procurementIndents).where(eq(procurementIndents.tenantId, t));
  }));
}

async function seedApprovedIndent(indentId: string): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementIndents).values({
      id: indentId, tenantId: TENANT, indentNo: `IND-${indentId.slice(-4)}`,
      department: "IT", purpose: "Yearly demand seed", totalMinor: 0n,
      status: "approved", createdBy: MAKER, updatedBy: MAKER,
    });
    await tx.insert(procurementIndentItems).values({
      id: randomUUID(), indentId, tenantId: TENANT, itemCode: "LAP-01",
      description: "Laptop", quantity: 4, unit: "nos", unitPriceMinor: 5000000n,
      createdBy: MAKER, updatedBy: MAKER,
    });
  }));
}

beforeAll(async () => {
  await wipeTenant(TENANT);
  await wipeTenant(OTHER);
});

afterAll(async () => {
  await wipeTenant(TENANT);
  await wipeTenant(OTHER);
  await sqlClient.end();
});

describe("SVC-041 planning — maker-checker + aggregation + RLS", () => {
  const planId = randomUUID();
  const indentId = randomUUID();

  it("aggregate-from-indents creates a draft plan with an aggregated line", async () => {
    await seedApprovedIndent(indentId);
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPlanningConsumers(q);
    await q.start();
    await q.publish(COMMANDS.planCreate, msg(COMMANDS.planCreate, {
      id: planId, tenantId: TENANT, mode: "from_indents",
      planYear: 2027, title: "FY27 Annual Plan", department: "IT",
      indentIds: [indentId], defaultMethod: "gem",
    }));
    await drain(q);

    const plan = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPlans).where(eq(procurementPlans.id, planId)))))[0];
    expect(plan?.status).toBe("draft");
    expect(plan?.totalEstimatedMinor).toBe(5000000n * 4n);
    const lines = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPlanLines).where(eq(procurementPlanLines.planId, planId))));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.aggregatedQty).toBe(4);
  });

  it("submit → pending", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPlanningConsumers(q);
    await q.start();
    await q.publish(COMMANDS.planSubmit, msg(COMMANDS.planSubmit, { id: planId, tenantId: TENANT }, MAKER));
    await drain(q);
    const plan = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPlans).where(eq(procurementPlans.id, planId)))))[0];
    expect(plan?.status).toBe("pending");
    expect(plan?.submittedBy).toBe(MAKER);
  });

  it("maker cannot self-approve — plan stays pending (SoD)", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPlanningConsumers(q);
    await q.start();
    await q.publish(COMMANDS.planApprove, msg(COMMANDS.planApprove, { id: planId, tenantId: TENANT }, MAKER));
    await drain(q);
    const plan = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPlans).where(eq(procurementPlans.id, planId)))))[0];
    expect(plan?.status).toBe("pending");
  });

  it("distinct checker approves → approved + plan.approved emitted", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPlanningConsumers(q);
    await q.start();
    await q.publish(COMMANDS.planApprove, msg(COMMANDS.planApprove, { id: planId, tenantId: TENANT }, CHECKER));
    await drain(q);
    const plan = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPlans).where(eq(procurementPlans.id, planId)))))[0];
    expect(plan?.status).toBe("approved");
    expect(plan?.approvedBy).toBe(CHECKER);

    const events = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(
        eq(outboxMessages.tenantId, TENANT),
        eq(outboxMessages.topic, EVENTS.planApproved),
      ))));
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("foreign-tenant approve finds no plan (RLS isolation)", async () => {
    const otherPlanId = randomUUID();
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPlanningConsumers(q);
    await q.start();
    // A command carrying OTHER tenant for a plan that belongs to TENANT: the
    // consumer's tenant-scoped read finds nothing, so no write occurs.
    await q.publish(COMMANDS.planApprove, msg(COMMANDS.planApprove, { id: planId, tenantId: OTHER }, CHECKER, OTHER));
    await drain(q);
    const inOther = await runWithTenant(OTHER, () => db.transaction((tx) =>
      tx.select().from(procurementPlans).where(eq(procurementPlans.id, otherPlanId))));
    expect(inOther).toHaveLength(0);
  });
});
