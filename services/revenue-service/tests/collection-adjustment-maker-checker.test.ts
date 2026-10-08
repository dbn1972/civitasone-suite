/**
 * GAP-REVENUE-ADJUSTMENTS-01 — balance-transfer adjustments now require
 * maker-checker. A transfer must NOT move the DCB balance until a DISTINCT
 * officer approves it, mirroring refunds and remissions.
 *
 * This fails on the old code, where adjustmentCreate applied the debit/credit
 * immediately with no pending state and no checker!=maker rule (a single
 * officer could silently move arrears off a defaulter's demand).
 *
 * DB-backed, no mocks: drives the real collection consumers (adjustmentCreate +
 * adjustmentDecide) through a MemoryQueue against the test Postgres, exactly
 * like collection-receipt-nested-tx-deadlock.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { adjustments } from "../src/modules/collection/schema.js";
import { dcbEntries } from "../src/modules/assessment/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerCollectionConsumers } from "../src/modules/collection/consumer.js";
import { getDemandBalance } from "../src/modules/collection/repo.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "ad010000-0000-4000-8000-00000000ad10";
const ASSESSEE = "ad010000-0000-4000-8000-0000000000ee";
const FROM_DEMAND = "ad010000-0000-4000-8000-0000000de111";
const TO_DEMAND = "ad010000-0000-4000-8000-0000000de222";
const MAKER = "ad010000-0000-4000-8000-00000000a000";
const CHECKER = "ad010000-0000-4000-8000-0000000c0ec0";

const FROM_SEEDED = 1_000_000n; // ₹10,000.00 outstanding on the source demand
const TO_SEEDED = 500_000n; //  ₹5,000.00 outstanding on the target demand
const TRANSFER = 300_000n; //    ₹3,000.00 to move

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function makeMsg(type: string, actorId: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: TENANT,
    actorId,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(adjustments).where(eq(adjustments.tenantId, TENANT));
      await tx.delete(dcbEntries).where(eq(dcbEntries.tenantId, TENANT));
    }),
  );
}

async function seedDemands() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(dcbEntries).values({
        id: randomUUID(), tenantId: TENANT, assesseeId: ASSESSEE, demandId: FROM_DEMAND,
        entryType: "demand", amountMinor: FROM_SEEDED, balanceMinor: FROM_SEEDED,
        referenceType: "demand", narration: "ADJ-01 source fixture", createdBy: MAKER,
      });
      await tx.insert(dcbEntries).values({
        id: randomUUID(), tenantId: TENANT, assesseeId: ASSESSEE, demandId: TO_DEMAND,
        entryType: "demand", amountMinor: TO_SEEDED, balanceMinor: TO_SEEDED,
        referenceType: "demand", narration: "ADJ-01 target fixture", createdBy: MAKER,
      });
    }),
  );
}

async function startConsumers(): Promise<MemoryQueue> {
  const q = wireTenantAwareQueue(new MemoryQueue()) as MemoryQueue;
  registerCollectionConsumers(q);
  await q.start();
  return q;
}

async function listAdjustments() {
  return runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.select().from(adjustments).where(eq(adjustments.tenantId, TENANT)),
    ),
  );
}

beforeAll(async () => {
  await clean();
});

beforeEach(async () => {
  await clean();
  await seedDemands();
});

afterAll(async () => {
  await clean();
  await sqlClient.end();
});

describe("adjustment maker-checker (GAP-REVENUE-ADJUSTMENTS-01, real DB)", () => {
  it("create records a PENDING adjustment and does NOT move any balance", async () => {
    const q = await startConsumers();
    await q.publish(
      COMMANDS.adjustmentCreate,
      makeMsg(COMMANDS.adjustmentCreate, MAKER, {
        assesseeId: ASSESSEE,
        fromDemandId: FROM_DEMAND,
        toDemandId: TO_DEMAND,
        amountMinor: TRANSFER.toString(),
        reason: "Move credit to current year",
      }),
    );
    await q.drain();

    const rows = await listAdjustments();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.makerUserId).toBe(MAKER);
    expect(rows[0]!.checkerUserId).toBeNull();

    // Balances UNCHANGED — the transfer has not been applied.
    const fromBal = await getDemandBalance(TENANT, FROM_DEMAND);
    const toBal = await getDemandBalance(TENANT, TO_DEMAND);
    expect(fromBal).toBe(FROM_SEEDED);
    expect(toBal).toBe(TO_SEEDED);

    await q.stop();
  });

  it("same-officer decide is REJECTED by maker-checker and leaves the balance unmoved (DLQ records the violation)", async () => {
    const q = await startConsumers();
    await q.publish(
      COMMANDS.adjustmentCreate,
      makeMsg(COMMANDS.adjustmentCreate, MAKER, {
        assesseeId: ASSESSEE, fromDemandId: FROM_DEMAND, toDemandId: TO_DEMAND,
        amountMinor: TRANSFER.toString(), reason: "self-approve attempt",
      }),
    );
    await q.drain();
    const [adj] = await listAdjustments();

    // The MAKER tries to approve their own transfer — assertMakerChecker throws.
    await q.publish(
      COMMANDS.adjustmentDecide,
      makeMsg(COMMANDS.adjustmentDecide, MAKER, { adjustmentId: adj!.id, approve: true }),
    );
    await q.drain();

    expect(q.dlq.length).toBeGreaterThan(0); // the maker-checker violation surfaced, not a silent success

    const rows = await listAdjustments();
    expect(rows[0]!.status).toBe("pending"); // still pending — not approved
    const fromBal = await getDemandBalance(TENANT, FROM_DEMAND);
    expect(fromBal).toBe(FROM_SEEDED); // balance NOT moved

    await q.stop();
  });

  it("a DISTINCT checker approval applies the transfer, moves both balances, and emits adjustmentApplied", async () => {
    const q = await startConsumers();
    await q.publish(
      COMMANDS.adjustmentCreate,
      makeMsg(COMMANDS.adjustmentCreate, MAKER, {
        assesseeId: ASSESSEE, fromDemandId: FROM_DEMAND, toDemandId: TO_DEMAND,
        amountMinor: TRANSFER.toString(), reason: "approved transfer",
      }),
    );
    await q.drain();
    const [adj] = await listAdjustments();

    await q.publish(
      COMMANDS.adjustmentDecide,
      makeMsg(COMMANDS.adjustmentDecide, CHECKER, { adjustmentId: adj!.id, approve: true }),
    );
    await q.drain();

    expect(q.dlq).toHaveLength(0);

    const rows = await listAdjustments();
    expect(rows[0]!.status).toBe("approved");
    expect(rows[0]!.checkerUserId).toBe(CHECKER);
    expect(rows[0]!.decidedAt).toBeInstanceOf(Date);

    // Balance MOVED: source debited, target credited.
    const fromBal = await getDemandBalance(TENANT, FROM_DEMAND);
    const toBal = await getDemandBalance(TENANT, TO_DEMAND);
    expect(fromBal).toBe(FROM_SEEDED - TRANSFER);
    expect(toBal).toBe(TO_SEEDED + TRANSFER);

    // adjustmentApplied event was written to the outbox in the same txn.
    const events = await runWithTenant(TENANT, () =>
      db.transaction((tx) =>
        tx.select().from(outboxMessages).where(
          and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.eventType, EVENTS.adjustmentApplied)),
        ),
      ),
    );
    expect(events).toHaveLength(1);

    await q.stop();
  });

  it("a DISTINCT checker REJECTION leaves balances unmoved and emits no adjustmentApplied", async () => {
    const q = await startConsumers();
    await q.publish(
      COMMANDS.adjustmentCreate,
      makeMsg(COMMANDS.adjustmentCreate, MAKER, {
        assesseeId: ASSESSEE, fromDemandId: FROM_DEMAND, toDemandId: TO_DEMAND,
        amountMinor: TRANSFER.toString(), reason: "to be rejected",
      }),
    );
    await q.drain();
    const [adj] = await listAdjustments();

    await q.publish(
      COMMANDS.adjustmentDecide,
      makeMsg(COMMANDS.adjustmentDecide, CHECKER, { adjustmentId: adj!.id, approve: false, reason: "not justified" }),
    );
    await q.drain();

    expect(q.dlq).toHaveLength(0);
    const rows = await listAdjustments();
    expect(rows[0]!.status).toBe("rejected");
    expect(rows[0]!.decisionReason).toBe("not justified");
    const fromBal = await getDemandBalance(TENANT, FROM_DEMAND);
    const toBal = await getDemandBalance(TENANT, TO_DEMAND);
    expect(fromBal).toBe(FROM_SEEDED); // unmoved
    expect(toBal).toBe(TO_SEEDED);

    const events = await runWithTenant(TENANT, () =>
      db.transaction((tx) =>
        tx.select().from(outboxMessages).where(
          and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.eventType, EVENTS.adjustmentApplied)),
        ),
      ),
    );
    expect(events).toHaveLength(0);

    await q.stop();
  });

  it("a second decide on an already-approved adjustment is a no-op (no double balance move)", async () => {
    const q = await startConsumers();
    await q.publish(
      COMMANDS.adjustmentCreate,
      makeMsg(COMMANDS.adjustmentCreate, MAKER, {
        assesseeId: ASSESSEE, fromDemandId: FROM_DEMAND, toDemandId: TO_DEMAND,
        amountMinor: TRANSFER.toString(), reason: "double-decide",
      }),
    );
    await q.drain();
    const [adj] = await listAdjustments();

    await q.publish(
      COMMANDS.adjustmentDecide,
      makeMsg(COMMANDS.adjustmentDecide, CHECKER, { adjustmentId: adj!.id, approve: true }),
    );
    await q.drain();
    // A replayed/duplicate approval (fresh messageId) must not move the balance again.
    await q.publish(
      COMMANDS.adjustmentDecide,
      makeMsg(COMMANDS.adjustmentDecide, CHECKER, { adjustmentId: adj!.id, approve: true }),
    );
    await q.drain();

    const fromBal = await getDemandBalance(TENANT, FROM_DEMAND);
    expect(fromBal).toBe(FROM_SEEDED - TRANSFER); // moved exactly once

    await q.stop();
  });
});
