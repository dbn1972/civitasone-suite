/**
 * Regression: CQRS milestone completion/late + performance bond register/transition.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import {
  contractContracts, contractMilestones, contractPerformanceBonds, contractAmendments,
} from "../src/modules/contracts/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerContractConsumers } from "../src/modules/contracts/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const MAKER = "00000000-bbbb-4000-8000-0000000000b1";
const CHECKER = "00000000-bbbb-4000-8000-0000000000b2";
const TENANT = "22222222-bbbb-4000-8000-0000000000ff";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function wipe() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(contractPerformanceBonds).where(eq(contractPerformanceBonds.tenantId, TENANT));
    await tx.delete(contractMilestones).where(eq(contractMilestones.tenantId, TENANT));
    await tx.delete(contractAmendments).where(eq(contractAmendments.tenantId, TENANT));
    await tx.delete(contractContracts).where(eq(contractContracts.tenantId, TENANT));
  }));
}

function pub(q: MemoryQueue, type: string, actorId: string, payload: Record<string, unknown>, messageId = randomUUID()) {
  return q.publish(type, {
    messageId, type, tenantId: TENANT, actorId,
    correlationId: "corr-" + messageId.slice(0, 8), schemaVersion: "1.0", payload,
  });
}

async function waitForContractStatus(id: string, want: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const [row] = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(contractContracts).where(eq(contractContracts.id, id))));
    if (row?.status === want) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`contract ${id} did not reach status ${want}`);
}

async function waitForMilestone(id: string, want: string) {
  for (let i = 0; i < 40; i++) {
    const [ms] = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(contractMilestones).where(eq(contractMilestones.id, id))));
    if (ms?.status === want) return ms;
    await new Promise((r) => setTimeout(r, 100));
  }
  const [ms] = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
    tx.select().from(contractMilestones).where(eq(contractMilestones.id, id))));
  throw new Error(`milestone ${id} status=${ms?.status} want=${want}`);
}

describe("milestones + performance bonds (CQRS integration)", () => {
  let q: MemoryQueue;

  beforeAll(async () => {
    await wipe();
    q = wireTenantAwareQueue(new MemoryQueue()) as MemoryQueue;
    registerContractConsumers(q);
    await q.start();
  });

  afterAll(async () => {
    await q.stop();
    await wipe();
    await sqlClient.end();
  });

  it("marks milestone late with bigint penalty via queue consumer + audit/outbox", { timeout: 20_000 }, async () => {
    const contractId = randomUUID();

    await pub(q, COMMANDS.contractCreate, MAKER, {
      id: contractId, tenantId: TENANT, contractNo: `CTR-BOND-${contractId.slice(0, 8)}`, vendorId: randomUUID(),
      title: "Road works", valueMinor: 5_000_000, currency: "INR",
      startDate: "2026-01-01", expiry: "2026-12-31",
      slaTerms: { penaltyRatePct: 0.5, maxPenaltyPct: 10 },
      milestones: [{ title: "Earthwork", dueDate: "2026-06-01", amountMinor: 1_000_000 }],
    });
    await waitForContractStatus(contractId, "draft");

    let mid = "";
    for (let i = 0; i < 40 && !mid; i++) {
      const milestones = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
        tx.select().from(contractMilestones).where(eq(contractMilestones.contractId, contractId))));
      if (milestones[0]) mid = milestones[0].id;
      else await new Promise((r) => setTimeout(r, 100));
    }
    expect(mid).not.toBe("");

    await pub(q, COMMANDS.contractApprove, CHECKER, { id: contractId, tenantId: TENANT });
    await waitForContractStatus(contractId, "approved");
    await pub(q, COMMANDS.contractActivate, CHECKER, { id: contractId, tenantId: TENANT });
    await waitForContractStatus(contractId, "active");

    await pub(q, COMMANDS.milestoneMarkLate, CHECKER, {
      contractId, milestoneId: mid, tenantId: TENANT, achievedDate: "2026-06-15", notes: "rain delay",
    });
    const ms = await waitForMilestone(mid, "completed_late");
    expect(ms.penaltyMinor).toBe(10_000n);
    expect(ms.netPayableMinor).toBe(990_000n);

    const events = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    expect(events.some((e) => e.topic === EVENTS.milestoneCompleted)).toBe(true);
    expect(events.some((e) => e.topic === "audit.event.record")).toBe(true);
  });

  it("registers and releases a performance bond with tenant-scoped ledger", { timeout: 20_000 }, async () => {
    const contractId = randomUUID();
    const bondId = randomUUID();

    await pub(q, COMMANDS.contractCreate, MAKER, {
      id: contractId, tenantId: TENANT, contractNo: `CTR-BG-${contractId.slice(0, 8)}`, vendorId: randomUUID(),
      title: "Bridge", valueMinor: 9_000_000, currency: "INR",
      startDate: "2026-01-01", expiry: "2027-01-01",
    });
    await waitForContractStatus(contractId, "draft");
    await pub(q, COMMANDS.contractApprove, CHECKER, { id: contractId, tenantId: TENANT });
    await waitForContractStatus(contractId, "approved");

    await pub(q, COMMANDS.bondRegister, CHECKER, {
      id: bondId, contractId, tenantId: TENANT, bondType: "performance",
      amountMinor: 450_000, currency: "INR", issuer: "SBI", referenceNo: `BG-${bondId.slice(0, 8)}`,
      validFrom: "2026-01-01", validTo: "2027-01-01",
    });

    let held = false;
    for (let i = 0; i < 40; i++) {
      const bonds = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
        tx.select().from(contractPerformanceBonds).where(eq(contractPerformanceBonds.id, bondId))));
      if (bonds[0]?.status === "held") { held = true; expect(bonds[0]?.amountMinor).toBe(450_000n); break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(held).toBe(true);

    await pub(q, COMMANDS.bondTransition, CHECKER, {
      contractId, bondId, tenantId: TENANT, toStatus: "released", notes: "defect liability cleared",
    });
    for (let i = 0; i < 40; i++) {
      const [after] = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
        tx.select().from(contractPerformanceBonds).where(eq(contractPerformanceBonds.id, bondId))));
      if (after?.status === "released") {
        expect(after.status).toBe("released");
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("bond was not released");
  });
});
