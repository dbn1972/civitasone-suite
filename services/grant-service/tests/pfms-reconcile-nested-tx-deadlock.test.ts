/**
 * grant-service PFMS reconcile nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: pfmsReconcile (disbursement/consumer.ts) called
 * repo.findDisbursementByPfmsTxnId -- scopedRead-based, opens its OWN
 * db.transaction() -- once PER RECORD in its reconciliation batch, from
 * INSIDE its own already-open outer db.transaction(). Real disbursement
 * reconciliation against India's PFMS treasury system -- concurrent
 * reconcile batches across tenants/schemes at settlement time is a
 * realistic trigger. Same shape as notification-service (#1028),
 * building-service (#1035), payroll-service (#1042, #1048),
 * finance-service (#1043), hrms-service (#1045, #1047).
 *
 * Since the loop is SEQUENTIAL within one command (one outer transaction,
 * one nested connection needed at a time), a single large batch can't
 * self-deadlock -- the risk is CONCURRENT pfmsReconcile commands each
 * holding an outer + momentary nested connection. This test fires
 * pool.max + concurrency concurrent reconcile commands, each with a small
 * batch, to prove that shape doesn't deadlock the pool.
 *
 * Fixed by routing onto findDisbursementByPfmsTxnIdTx, reading through the
 * caller's already-open tx.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerDisbursementConsumers } from "../src/modules/disbursement/consumer.js";
import { grantDisbursements } from "../src/modules/disbursement/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "c0000000-dead-4000-8000-00000000c0de";
const ACTOR = "c0000000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("grant-service pfmsReconcile -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent pfmsReconcile batches drain without deadlocking the connection pool`,
    async () => {
      const batches: Array<{ pfmsTxnId: string }[]> = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const recordsForBatch: { pfmsTxnId: string }[] = [];
        for (let j = 0; j < 2; j++) {
          const pfmsTxnId = `PFMS-${randomUUID().slice(0, 12)}`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await withTenantScope(db, TENANT, (tx: any) => tx.insert(grantDisbursements).values({
            id: randomUUID(), tenantId: TENANT, installmentId: randomUUID(),
            amountMinor: 500000n, pfmsTxnId, status: "initiated",
            createdBy: ACTOR, updatedBy: ACTOR,
          }));
          recordsForBatch.push({ pfmsTxnId });
        }
        batches.push(recordsForBatch);
      }

      const q = tenantWrappedQueue();
      registerDisbursementConsumers(q);
      await q.start();

      await Promise.all(batches.map((records) =>
        q.publish(COMMANDS.pfmsReconcile, makeMsg(COMMANDS.pfmsReconcile, {
          tenantId: TENANT,
          records: records.map((r) => ({ pfmsTxnId: r.pfmsTxnId, status: "completed" })),
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
