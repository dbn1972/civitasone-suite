/**
 * TX-001 (citizen-service slice) — fee-payment module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep
 * (evidence column: `fee-payment:284`): COMMANDS.refundRequest calls
 * `repo.listRefundsByPayment(tenantId, paymentId)` -- a db.transaction()-based
 * read that opens its OWN transaction -- from INSIDE an already-open outer
 * db.transaction(). Under pool.max concurrent in-flight consumer
 * transactions, every one of them needs a second ("nested") pool connection
 * at the same moment none is free, deadlocking the whole queue silently
 * forever.
 *
 * This test exercises refundRequest across many DIFFERENT payments at
 * pool.max + 3 concurrency, real Postgres, real pool -- a realistic trigger
 * (many citizens requesting refunds on unrelated payments at the same
 * moment, e.g. after a fee-schedule correction).
 *
 * Fixed by routing onto repo.listRefundsByPaymentTx(tx, ...), reading
 * through the caller's already-open tx.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { feePayments, feeRefunds } from "../src/modules/fee-payment/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerFeePaymentConsumers } from "../src/modules/fee-payment/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "fee00000-dead-4000-8000-00000000fee0";
const CITIZEN = "fee00000-dead-4000-8000-0000000c17ce";
const APPLICATION = "fee00000-dead-4000-8000-0000000a99ee";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;

function makeMsg(id: string, type: string, payload: Record<string, unknown>) {
  return {
    messageId: id, type, tenantId: TENANT,
    actorId: CITIZEN, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(feeRefunds).where(eq(feeRefunds.tenantId, TENANT));
      await tx.delete(feePayments).where(eq(feePayments.tenantId, TENANT));
    }),
  );
}

const paymentIds = Array.from({ length: CONCURRENCY }, () => randomUUID());

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      for (const id of paymentIds) {
        await tx.insert(feePayments).values({
          id, tenantId: TENANT, applicationId: APPLICATION, citizenId: CITIZEN,
          amount: 50000, currency: "INR", method: "online", status: "paid",
          reconciliationStatus: "reconciled",
          createdBy: CITIZEN, updatedBy: CITIZEN,
        });
      }
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("fee-payment consumer refundRequest -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent refundRequest commands on DIFFERENT payments drain without deadlocking the connection pool",
    async () => {
      const q: Queue = new MemoryQueue();
      registerFeePaymentConsumers(q);
      await q.start();

      const refundIds = paymentIds.map(() => randomUUID());

      await Promise.all(paymentIds.map((paymentId, i) =>
        q.publish(COMMANDS.refundRequest, makeMsg(randomUUID(), COMMANDS.refundRequest, {
          id: refundIds[i], tenantId: TENANT, paymentId, amount: 10000,
          reason: "Concurrent refund " + i,
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);
      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- assert the DLQ is empty so a silent per-command failure
      // isn't masked by a "drained" queue.
      expect((q as MemoryQueue).dlq, "handler errors were swallowed into the DLQ: " + JSON.stringify((q as MemoryQueue).dlq)).toHaveLength(0);

      const rows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(feeRefunds).where(inArray(feeRefunds.id, refundIds))),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        expect(row.status).toBe("requested");
        expect(paymentIds).toContain(row.paymentId);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
