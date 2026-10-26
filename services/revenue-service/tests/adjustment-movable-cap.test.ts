/**
 * Owner decision #5 (2026-10-26) — balance-transfer adjustments.
 *
 * GAP-REVENUE-ADJUSTMENTS-03: only PRINCIPAL is movable; penalty and
 *     interest stay with their demand; the cap is the LIVE DCB outstanding
 *     (not the stale net demand figure) minus the penalty+interest that must
 *     stay behind. Enforced server-side, at create AND again at approval.
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

const TENANT = "ad050000-0000-4000-8000-00000000ad50";
const ASSESSEE = "ad050000-0000-4000-8000-0000000000ee";
const FROM_DEMAND = "ad050000-0000-4000-8000-0000000de111";
const TO_DEMAND = "ad050000-0000-4000-8000-0000000de222";
const MAKER = "ad050000-0000-4000-8000-00000000a000";
const CHECKER = "ad050000-0000-4000-8000-0000000c0ec0";
const HEAD = "ad050000-0000-4000-8000-0000000a0a0a";

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

describe("adjustment movable cap — principal only, live DCB (owner decision #5)", () => {
  it("refuses a transfer above the movable principal (penalty+interest stay with the demand)", async () => {
    const q = await start();
    // Above principal (800,000) but still within the net/DCB figure (1,000,000): the OLD cap let this through.
    await create(q, 800_001n);
    expect(await rows()).toHaveLength(0);
    expect(q.dlq.length).toBeGreaterThan(0);
    await q.stop();
  });

  it("accepts a transfer of exactly the movable principal", async () => {
    const q = await start();
    await create(q, PRINCIPAL);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe("pending");
    await q.stop();
  });

  it("caps against the LIVE DCB outstanding, not the stale net demand (partial payment shrinks the cap)", async () => {
    // A receipt of 600,000 leaves outstanding 400,000 => movable = 400,000 - 200,000 = 200,000.
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(dcbEntries).values({
        id: randomUUID(), tenantId: TENANT, assesseeId: ASSESSEE, demandId: FROM_DEMAND, entryType: "collection",
        amountMinor: 600_000n, balanceMinor: 400_000n, referenceType: "receipt", narration: "part payment",
        createdBy: MAKER, createdAt: new Date(Date.now() + 5_000),
      });
    }));
    const q = await start();
    await create(q, 200_001n);
    expect(await rows()).toHaveLength(0);
    await create(q, 200_000n);
    expect(await rows()).toHaveLength(1);
    await q.stop();
  });

  it("does not double count: the rate engine books interest AS the penalty (penalty === interest, net carries it once)", async () => {
    // Engine-shaped demand: principal 800,000 + penalty 100,000 (= interest 100,000, one charge) => net 900,000.
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.update(demands).set({ penaltyMinor: 100_000n, interestMinor: 100_000n, netMinor: 900_000n }).where(eq(demands.id, FROM_DEMAND));
      await tx.update(dcbEntries).set({ amountMinor: 900_000n, balanceMinor: 900_000n }).where(eq(dcbEntries.demandId, FROM_DEMAND));
    }));
    const q = await start();
    await create(q, 800_001n); // above the 800,000 principal
    expect(await rows()).toHaveLength(0);
    await create(q, PRINCIPAL); // exactly the principal: must be allowed (a sum of penalty+interest would wrongly cap at 700,000)
    expect(await rows()).toHaveLength(1);
    await q.stop();
  });

  it("re-checks the cap at approval: a payment that lands between request and approval blocks the transfer", async () => {
    const q = await start();
    await create(q, PRINCIPAL);
    const [adj] = await rows();
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(dcbEntries).values({
        id: randomUUID(), tenantId: TENANT, assesseeId: ASSESSEE, demandId: FROM_DEMAND, entryType: "collection",
        amountMinor: 500_000n, balanceMinor: 500_000n, referenceType: "receipt", narration: "late payment",
        createdBy: MAKER, createdAt: new Date(Date.now() + 5_000),
      });
    }));
    await q.publish(COMMANDS.adjustmentDecide, msg(COMMANDS.adjustmentDecide, CHECKER, { adjustmentId: adj!.id, approve: true }));
    await q.drain();
    expect((await rows())[0]!.status).toBe("pending"); // txn rolled back
    expect(await getDemandBalance(TENANT, FROM_DEMAND)).toBe(500_000n); // unmoved
    await q.stop();
  });
});

