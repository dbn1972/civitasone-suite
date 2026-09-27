/**
 * Integration test (real Postgres, no mocks) for EMD/SD deposit disposition
 * (refund / forfeit / adjust) — services/finance-service/src/modules/treasury/
 * repo.ts's applyDepositDispositionGuarded + consumer.ts's depositDisposition.
 *
 * Regression coverage for two compounding bugs found in a functional sweep:
 *
 *   Bug 1 (repo.ts applyDepositDispositionGuarded): the guarded UPDATE's
 *   success check read `res.rowCount`, but this project's Postgres driver is
 *   `postgres` (porsager), whose result exposes the affected-row count as
 *   `.count` — `.rowCount` is the *different* `pg` driver's property name and
 *   is always `undefined` here. The guard therefore always read "0 rows
 *   affected" and depositDisposition always threw DEPOSIT_OVERDRAW, even for
 *   a trivially legitimate partial disposition well within balance.
 *
 *   Bug 2 (same function): the status-transition CASE mapped a fully-drained
 *   balance to `'closed'`, a value that does not exist in
 *   treasury.finance_deposits' status CHECK constraint (migration 0036:
 *   'active' | 'forfeited' | 'refunded'). Even with bug 1 fixed in isolation,
 *   any disposition that drains a deposit to exactly 0 (a full refund or full
 *   forfeiture — an everyday scenario) crashed with a raw Postgres 23514
 *   check_violation instead of succeeding.
 *
 * Runs the REAL registerTreasuryConsumers against a real Postgres connection
 * (this service's own DB, RLS included) — not the mocked-repo unit tests in
 * treasury-consumer.test.ts (which mock applyDepositDispositionGuarded itself
 * and so cannot see either bug).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { registerTreasuryConsumers } from "../src/modules/treasury/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeDeposits, type DepositRow } from "../src/modules/treasury/schema.js";

// Platform default tenant — migrations 0014/0015 already seed the AP (2050),
// deposit-liability (2060) and forfeit-income (4300) control heads for it, so
// only the bank head (1100) needs seeding here (mirrors
// municipal-challan-integration.test.ts's own beforeAll for the same reason).
const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "bb000001-ec00-4000-8000-0000000000ff";
const BANK_CODE = "1100";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

/** Mirrors worker.ts's global subscribe wrap: every handler runs under the
 *  message's tenant GUC so FORCE RLS reads/writes succeed, exactly like production. */
function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

beforeAll(async () => {
  await scoped(TENANT, (tx: any) =>
    tx.insert(financeHeads).values({
      id: randomUUID(), tenantId: TENANT, code: BANK_CODE, name: "Bank (treasury-deposit-disposition test)",
      level: 1, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing(),
  );
});

async function seedDeposit(balanceMinor: bigint, type: "pd" | "emd" | "sd" | "fdr" = "emd"): Promise<string> {
  const id = randomUUID();
  await scoped(TENANT, (tx: any) =>
    tx.insert(financeDeposits).values({
      id, tenantId: TENANT, pdNo: `PD/${id.slice(0, 8)}`, type,
      administrator: "Test Contractor", balanceMinor, currency: "INR", status: "active",
      createdBy: ACTOR, updatedBy: ACTOR,
    }),
  );
  return id;
}

async function readDeposit(id: string): Promise<DepositRow> {
  const [row] = await scoped(TENANT, (tx: any) =>
    tx.select().from(financeDeposits).where(eq(financeDeposits.id, id)).limit(1),
  );
  expect(row, `deposit ${id} must exist`).toBeTruthy();
  return row;
}

describe("treasury deposit disposition — real DB, no mocks", () => {
  describe("refund", () => {
    it("partial refund succeeds: decrements balance, keeps status active", async () => {
      const depositId = await seedDeposit(500_000n);
      const q = tenantWrappedQueue(); registerTreasuryConsumers(q); await q.start();
      await q.publish(COMMANDS.depositRefund, makeMsg(COMMANDS.depositRefund, {
        id: randomUUID(), tenantId: TENANT, depositId, amountMinor: 200_000,
      }));
      await q.drain();
      expect(q.dlq, JSON.stringify(q.dlq)).toHaveLength(0);
      const row = await readDeposit(depositId);
      expect(row.balanceMinor).toBe(300_000n);
      expect(row.refundedMinor).toBe(200_000n);
      expect(row.status).toBe("active");
      await q.stop();
    });

    it("full-drain refund succeeds and lands on status 'refunded'", async () => {
      const depositId = await seedDeposit(200_000n);
      const q = tenantWrappedQueue(); registerTreasuryConsumers(q); await q.start();
      await q.publish(COMMANDS.depositRefund, makeMsg(COMMANDS.depositRefund, {
        id: randomUUID(), tenantId: TENANT, depositId, amountMinor: 200_000,
      }));
      await q.drain();
      expect(q.dlq, JSON.stringify(q.dlq)).toHaveLength(0);
      const row = await readDeposit(depositId);
      expect(row.balanceMinor).toBe(0n);
      expect(row.refundedMinor).toBe(200_000n);
      expect(row.status).toBe("refunded");
      await q.stop();
    });

    it("over-refund exceeding balance is rejected with DEPOSIT_OVERDRAW, balance unchanged", async () => {
      const depositId = await seedDeposit(100_000n);
      const q = tenantWrappedQueue(); registerTreasuryConsumers(q); await q.start();
      await q.publish(COMMANDS.depositRefund, makeMsg(COMMANDS.depositRefund, {
        id: randomUUID(), tenantId: TENANT, depositId, amountMinor: 999_999,
      }));
      await q.drain();
      expect(q.dlq).toHaveLength(1);
      expect(q.dlq[0]!.error).toContain("DEPOSIT_OVERDRAW");
      const row = await readDeposit(depositId);
      expect(row.balanceMinor).toBe(100_000n);
      expect(row.refundedMinor).toBe(0n);
      expect(row.status).toBe("active");
      await q.stop();
    }, 20_000);
  });

  describe("forfeit", () => {
    it("partial forfeit succeeds: decrements balance, keeps status active", async () => {
      const depositId = await seedDeposit(500_000n);
      const q = tenantWrappedQueue(); registerTreasuryConsumers(q); await q.start();
      await q.publish(COMMANDS.depositForfeit, makeMsg(COMMANDS.depositForfeit, {
        id: randomUUID(), tenantId: TENANT, depositId, amountMinor: 150_000,
      }));
      await q.drain();
      expect(q.dlq, JSON.stringify(q.dlq)).toHaveLength(0);
      const row = await readDeposit(depositId);
      expect(row.balanceMinor).toBe(350_000n);
      expect(row.forfeitedMinor).toBe(150_000n);
      expect(row.status).toBe("active");
      await q.stop();
    });

    it("full-drain forfeit succeeds and lands on status 'forfeited'", async () => {
      const depositId = await seedDeposit(150_000n);
      const q = tenantWrappedQueue(); registerTreasuryConsumers(q); await q.start();
      await q.publish(COMMANDS.depositForfeit, makeMsg(COMMANDS.depositForfeit, {
        id: randomUUID(), tenantId: TENANT, depositId, amountMinor: 150_000,
      }));
      await q.drain();
      expect(q.dlq, JSON.stringify(q.dlq)).toHaveLength(0);
      const row = await readDeposit(depositId);
      expect(row.balanceMinor).toBe(0n);
      expect(row.forfeitedMinor).toBe(150_000n);
      expect(row.status).toBe("forfeited");
      await q.stop();
    });

    it("over-forfeit exceeding balance is rejected with DEPOSIT_OVERDRAW, balance unchanged", async () => {
      const depositId = await seedDeposit(50_000n);
      const q = tenantWrappedQueue(); registerTreasuryConsumers(q); await q.start();
      await q.publish(COMMANDS.depositForfeit, makeMsg(COMMANDS.depositForfeit, {
        id: randomUUID(), tenantId: TENANT, depositId, amountMinor: 50_001,
      }));
      await q.drain();
      expect(q.dlq).toHaveLength(1);
      expect(q.dlq[0]!.error).toContain("DEPOSIT_OVERDRAW");
      const row = await readDeposit(depositId);
      expect(row.balanceMinor).toBe(50_000n);
      expect(row.status).toBe("active");
      await q.stop();
    }, 20_000);
  });

  describe("adjust", () => {
    it("partial adjust succeeds: decrements balance, keeps status active", async () => {
      const depositId = await seedDeposit(500_000n, "sd");
      const q = tenantWrappedQueue(); registerTreasuryConsumers(q); await q.start();
      await q.publish(COMMANDS.depositAdjust, makeMsg(COMMANDS.depositAdjust, {
        id: randomUUID(), tenantId: TENANT, depositId, amountMinor: 100_000,
      }));
      await q.drain();
      expect(q.dlq, JSON.stringify(q.dlq)).toHaveLength(0);
      const row = await readDeposit(depositId);
      expect(row.balanceMinor).toBe(400_000n);
      expect(row.adjustedMinor).toBe(100_000n);
      expect(row.status).toBe("active");
      await q.stop();
    });

    // 'adjust' (deposit applied against a bill) has no dedicated terminal
    // status in the CHECK constraint ('active' | 'forfeited' | 'refunded') —
    // unlike refund/forfeit, a fully-adjusted deposit stays 'active' (see the
    // doc comment on applyDepositDispositionGuarded). This still must not
    // crash on the CHECK constraint the way the old 'closed' value did.
    it("full-drain adjust succeeds (balance 0) without crashing on the status CHECK constraint", async () => {
      const depositId = await seedDeposit(100_000n, "sd");
      const q = tenantWrappedQueue(); registerTreasuryConsumers(q); await q.start();
      await q.publish(COMMANDS.depositAdjust, makeMsg(COMMANDS.depositAdjust, {
        id: randomUUID(), tenantId: TENANT, depositId, amountMinor: 100_000, billId: randomUUID(),
      }));
      await q.drain();
      expect(q.dlq, JSON.stringify(q.dlq)).toHaveLength(0);
      const row = await readDeposit(depositId);
      expect(row.balanceMinor).toBe(0n);
      expect(row.adjustedMinor).toBe(100_000n);
      expect(row.status).toBe("active");
      await q.stop();
    });

    it("over-adjust exceeding balance is rejected with DEPOSIT_OVERDRAW, balance unchanged", async () => {
      const depositId = await seedDeposit(75_000n, "sd");
      const q = tenantWrappedQueue(); registerTreasuryConsumers(q); await q.start();
      await q.publish(COMMANDS.depositAdjust, makeMsg(COMMANDS.depositAdjust, {
        id: randomUUID(), tenantId: TENANT, depositId, amountMinor: 75_001,
      }));
      await q.drain();
      expect(q.dlq).toHaveLength(1);
      expect(q.dlq[0]!.error).toContain("DEPOSIT_OVERDRAW");
      const row = await readDeposit(depositId);
      expect(row.balanceMinor).toBe(75_000n);
      expect(row.status).toBe("active");
      await q.stop();
    }, 20_000);
  });
});
