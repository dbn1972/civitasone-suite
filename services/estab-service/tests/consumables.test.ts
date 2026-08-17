/**
 * Consumables domain + repo tests (Req 1.3 / 5.1).
 *
 *  1. isReorderRequired — boundary cases at threshold + the reorderLevel=0
 *     "no policy" carve-out.
 *  2. computeBalanceDelta / applyTransaction — txnType effects on balance,
 *     including the negative-balance guard.
 *  3. repo.upsertBalance — delta accumulation across two sequential calls,
 *     against the real dev Postgres (RLS-scoped via runWithTenant).
 *  4. consumer integration — estab.consumable.create followed by two
 *     estab.consumable.transaction messages persists the item and
 *     accumulates the balance through the full CQRS path.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { consumableItems, consumableTransactions } from "../src/modules/consumables/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerConsumablesConsumers } from "../src/modules/consumables/consumer.js";
import { COMMANDS } from "../src/topics.js";
import {
  isReorderRequired, computeBalanceDelta, applyTransaction,
  assertSufficientBalance, DomainError,
} from "../src/modules/consumables/domain.js";
import * as repo from "../src/modules/consumables/repo.js";

// Test-harness fix (see library.test.ts): a bare MemoryQueue does not
// auto-wrap handlers with withTenantConsumer the way the production
// createQueue() factory does — mirror that decoration here so consumer
// db.transaction() calls pick up the RLS tenant GUC.
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function insertItem(
  tenantId: string, id: string, actor: string,
  stockQty: string, reorderLevel: string,
): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.insert(consumableItems).values({
      id, tenantId, name: "Test Item", category: "stationery", unit: "piece",
      stockQty, reorderLevel, status: "active",
      createdBy: actor, updatedBy: actor,
    })),
  );
}

const tenants: string[] = [];
function freshTenant(): string {
  const t = randomUUID();
  tenants.push(t);
  return t;
}

afterAll(async () => {
  for (const tenantId of tenants) {
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        await tx.delete(consumableTransactions).where(inArray(consumableTransactions.tenantId, [tenantId]));
        await tx.delete(consumableItems).where(inArray(consumableItems.tenantId, [tenantId]));
        await tx.delete(outboxMessages).where(inArray(outboxMessages.tenantId, [tenantId]));
      }),
    );
  }
  await sqlClient.end();
});

// ── 1. isReorderRequired — boundary cases ───────────────────────────────

describe("domain.isReorderRequired", () => {
  it("balance == reorderLevel → true (at threshold triggers reorder)", () => {
    expect(isReorderRequired(10, 10)).toBe(true);
  });

  it("balance > reorderLevel → false (comfortably stocked)", () => {
    expect(isReorderRequired(15, 10)).toBe(false);
  });

  it("balance < reorderLevel → true (below threshold)", () => {
    expect(isReorderRequired(5, 10)).toBe(true);
  });

  it("reorderLevel == 0 → false, regardless of balance (no reorder policy)", () => {
    expect(isReorderRequired(0, 0)).toBe(false);
    expect(isReorderRequired(100, 0)).toBe(false);
  });

  it("negative reorderLevel is treated the same as no policy → false", () => {
    expect(isReorderRequired(0, -5)).toBe(false);
  });
});

// ── 2. computeBalanceDelta / applyTransaction — txnType effects ────────

describe("domain.computeBalanceDelta", () => {
  it("receipt increases balance (positive delta)", () => {
    expect(computeBalanceDelta("receipt", 10)).toBe(10);
  });

  it("return increases balance (positive delta)", () => {
    expect(computeBalanceDelta("return", 5)).toBe(5);
  });

  it("issue decreases balance (negative delta)", () => {
    expect(computeBalanceDelta("issue", 10)).toBe(-10);
  });

  it("adjustment carries its own sign", () => {
    expect(computeBalanceDelta("adjustment", -3)).toBe(-3);
    expect(computeBalanceDelta("adjustment", 3)).toBe(3);
  });
});

describe("domain.assertSufficientBalance", () => {
  it("does not throw when balance stays non-negative", () => {
    expect(() => assertSufficientBalance(10, -10)).not.toThrow();
  });

  it("throws INSUFFICIENT_BALANCE when it would go negative", () => {
    expect(() => assertSufficientBalance(5, -10)).toThrow(DomainError);
    try {
      assertSufficientBalance(5, -10);
      expect.fail("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("INSUFFICIENT_BALANCE");
    }
  });
});

describe("domain.applyTransaction", () => {
  it("issue that exactly zeroes the balance is allowed", () => {
    expect(applyTransaction(10, "issue", 10)).toBe(0);
  });

  it("issue larger than balance is rejected", () => {
    expect(() => applyTransaction(10, "issue", 11)).toThrow(DomainError);
  });

  it("receipt on top of an existing balance accumulates", () => {
    expect(applyTransaction(10, "receipt", 5)).toBe(15);
  });
});

// ── 3. repo.upsertBalance — delta accumulation (real DB) ────────────────

describe("repo.upsertBalance — delta accumulation", () => {
  it("calling upsertBalance twice accumulates the balance correctly", async () => {
    const T = freshTenant();
    const actor = randomUUID();
    const itemId = randomUUID();
    await insertItem(T, itemId, actor, "10.00", "5.00");

    const afterFirst = await runWithTenant(T, () => repo.upsertBalance(T, itemId, 5));
    expect(afterFirst).toBe(15);

    const afterSecond = await runWithTenant(T, () => repo.upsertBalance(T, itemId, -3));
    expect(afterSecond).toBe(12);

    const balance = await runWithTenant(T, () => repo.getBalance(T, itemId));
    expect(balance).toBe(12);
  });

  it("upsertBalance within a caller-supplied transaction participates in that transaction", async () => {
    const T = freshTenant();
    const actor = randomUUID();
    const itemId = randomUUID();
    await insertItem(T, itemId, actor, "0.00", "0.00");

    await runWithTenant(T, () =>
      db.transaction(async (tx) => {
        await repo.upsertBalance(T, itemId, 20, tx);
        await repo.upsertBalance(T, itemId, 10, tx);
      }),
    );

    const balance = await runWithTenant(T, () => repo.getBalance(T, itemId));
    expect(balance).toBe(30);
  });

  it("getBalance throws for an unknown item", async () => {
    const T = freshTenant();
    await expect(runWithTenant(T, () => repo.getBalance(T, randomUUID()))).rejects.toThrow();
  });
});

// ── 4. consumer integration — full CQRS path ─────────────────────────────

describe("consumables consumer — CQRS create + transaction", () => {
  it("estab.consumable.create then two transactions accumulate the persisted balance", async () => {
    const T = freshTenant();
    const actor = randomUUID();
    const itemId = randomUUID();

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerConsumablesConsumers(q);
    await q.start();

    await q.publish(COMMANDS.consumableCreate, {
      messageId: randomUUID(), type: COMMANDS.consumableCreate,
      tenantId: T, actorId: actor, correlationId: "corr-create-1", schemaVersion: "1.0",
      payload: { id: itemId, tenantId: T, name: "A4 Paper Ream", category: "stationery", unit: "ream", reorderLevel: 10 },
    });
    await new Promise<void>((r) => setTimeout(r, 300));

    await q.publish(COMMANDS.consumableTransaction, {
      messageId: randomUUID(), type: COMMANDS.consumableTransaction,
      tenantId: T, actorId: actor, correlationId: "corr-txn-1", schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: T, itemId, txnType: "receipt", qty: 50 },
    });
    await new Promise<void>((r) => setTimeout(r, 300));

    await q.publish(COMMANDS.consumableTransaction, {
      messageId: randomUUID(), type: COMMANDS.consumableTransaction,
      tenantId: T, actorId: actor, correlationId: "corr-txn-2", schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: T, itemId, txnType: "issue", qty: 15 },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await runWithTenant(T, () =>
      db.transaction((tx) => tx.select().from(consumableItems).where(eq(consumableItems.id, itemId))),
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.stockQty)).toBe(35);

    const txns = await runWithTenant(T, () =>
      db.transaction((tx) => tx.select().from(consumableTransactions).where(eq(consumableTransactions.itemId, itemId))),
    );
    expect(txns).toHaveLength(2);
  });

  it("an issue larger than the balance is rejected and does not change stock", async () => {
    const T = freshTenant();
    const actor = randomUUID();
    const itemId = randomUUID();
    await insertItem(T, itemId, actor, "10.00", "0.00");

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerConsumablesConsumers(q);
    await q.start();

    await q.publish(COMMANDS.consumableTransaction, {
      messageId: randomUUID(), type: COMMANDS.consumableTransaction,
      tenantId: T, actorId: actor, correlationId: "corr-txn-reject", schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: T, itemId, txnType: "issue", qty: 999 },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const balance = await runWithTenant(T, () => repo.getBalance(T, itemId));
    expect(balance).toBe(10);

    const txns = await runWithTenant(T, () =>
      db.transaction((tx) => tx.select().from(consumableTransactions).where(eq(consumableTransactions.itemId, itemId))),
    );
    expect(txns).toHaveLength(0);
  });
});
