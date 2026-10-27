/**
 * Owner decision #41 (2026-10-26) — GAP-REVENUE-ADJUSTMENTS-01: the
 * decide-step audit payload carries the from/to demand ids (and amount) so the
 * trail says which demands the balance moved between.
 *
 * DB-backed, no mocks: real adjustment consumers through a MemoryQueue.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { adjustments } from "../src/modules/collection/schema.js";
import { dcbEntries, demands } from "../src/modules/assessment/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerCollectionConsumers } from "../src/modules/collection/consumer.js";
import { getDemandBalance } from "../src/modules/collection/repo.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "ad410000-0000-4000-8000-00000000ad41";
const ASSESSEE = "ad410000-0000-4000-8000-0000000000ee";
const FROM_DEMAND = "ad410000-0000-4000-8000-0000000de111";
const TO_DEMAND = "ad410000-0000-4000-8000-0000000de222";
const MAKER = "ad410000-0000-4000-8000-00000000a000";
const CHECKER = "ad410000-0000-4000-8000-0000000c0ec0";
const HEAD = "ad410000-0000-4000-8000-0000000a0a0a";

// Source demand: principal 800,000 + penalty 150,000 + interest 50,000 = net 1,000,000
const PRINCIPAL = 800_000n;
const PENALTY = 150_000n;
const INTEREST = 50_000n;
const FROM_SEEDED = 1_000_000n;
const TO_SEEDED = 500_000n;

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
const msg = (type: string, actorId: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload,
});
async function clean() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(adjustments).where(eq(adjustments.tenantId, TENANT));
    await tx.delete(dcbEntries).where(eq(dcbEntries.tenantId, TENANT));
    await tx.delete(demands).where(eq(demands.tenantId, TENANT));
  }));
}
async function seed() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    for (const [id, principal, penalty, interest, net] of [
      [FROM_DEMAND, PRINCIPAL, PENALTY, INTEREST, FROM_SEEDED],
      [TO_DEMAND, TO_SEEDED, 0n, 0n, TO_SEEDED],
    ] as const) {
      await tx.insert(demands).values({
        id, tenantId: TENANT, assesseeId: ASSESSEE, assessmentId: randomUUID(), rateHeadId: HEAD,
        financialYear: "2025-2026", dueDate: "2025-06-30", principalMinor: principal, penaltyMinor: penalty,
        interestMinor: interest, netMinor: net, computeSnapshot: {}, createdBy: MAKER, updatedBy: MAKER,
      });
      await tx.insert(dcbEntries).values({
        id: randomUUID(), tenantId: TENANT, assesseeId: ASSESSEE, demandId: id, entryType: "demand",
        amountMinor: net, balanceMinor: net, referenceType: "demand", narration: "fixture", createdBy: MAKER,
      });
    }
  }));
}
async function start() {
  const q = wire(new MemoryQueue()) as MemoryQueue;
  registerCollectionConsumers(q);
  await q.start();
  return q;
}
async function create(q: MemoryQueue, amount: bigint) {
  await q.publish(COMMANDS.adjustmentCreate, msg(COMMANDS.adjustmentCreate, MAKER, {
    assesseeId: ASSESSEE, fromDemandId: FROM_DEMAND, toDemandId: TO_DEMAND,
    amountMinor: amount.toString(), reason: "move principal",
  }));
  await q.drain();
}
const rows = () => runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(adjustments).where(eq(adjustments.tenantId, TENANT))));

beforeAll(clean);
beforeEach(async () => { await clean(); await seed(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("adjustment decide audit payload (owner decision #41)", () => {
  it("carries fromDemandId, toDemandId and amountMinor on the decide audit event", async () => {
    const q = await start();
    await create(q, 300_000n);
    const [adj] = await rows();
    await q.publish(COMMANDS.adjustmentDecide, msg(COMMANDS.adjustmentDecide, CHECKER, { adjustmentId: adj!.id, approve: true }));
    await q.drain();
    const audits = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.eventType, "audit.event.record")))));
    const decide = audits.map((a) => a.payload as Record<string, unknown>).find((p) => p.action === "decide");
    expect(decide).toBeDefined();
    expect(decide!.fromDemandId).toBe(FROM_DEMAND);
    expect(decide!.toDemandId).toBe(TO_DEMAND);
    expect(decide!.amountMinor).toBe("300000");
    await q.stop();
  });

  it("also carries the demand ids when the checker REJECTS", async () => {
    const q = await start();
    await create(q, 300_000n);
    const [adj] = await rows();
    await q.publish(COMMANDS.adjustmentDecide, msg(COMMANDS.adjustmentDecide, CHECKER, { adjustmentId: adj!.id, approve: false, reason: "no" }));
    await q.drain();
    const audits = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.eventType, "audit.event.record")))));
    const decide = audits.map((a) => a.payload as Record<string, unknown>).find((p) => p.action === "decide");
    expect(decide!.fromDemandId).toBe(FROM_DEMAND);
    expect(decide!.toDemandId).toBe(TO_DEMAND);
    expect(decide!.outcome).toBe("rejected");
    await q.stop();
  });
});
