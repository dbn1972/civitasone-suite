/**
 * hrms-service contractor-bill module nested-transaction connection-pool
 * deadlock regression. Found via
 * .claude/skills/16-production-readiness-audit.md section 1:
 * contractor_bill_routes__4 (f3-consumer.ts) called scopedRead-based
 * repo.findBill and repo.findContractor from INSIDE its own already-open
 * outer db.transaction() -- two nested transactions competing for a
 * connection from the same pool as the outer one (plus the advisory-lock
 * `lockContractorForBilling` + `ytdApprovedGrossTx` calls, which already
 * correctly read through the caller's tx), deadlocking every in-flight
 * command once concurrency reaches pool.max.
 *
 * Fixed by routing findBill/findContractor onto findBillTx/findContractorTx
 * (repo.ts), reading through the caller's already-open tx. This test
 * exercises contractor_bill_routes__4 (approve) -- the case that chains
 * findBill then findContractor(bill.contractorId) inside one transaction,
 * the worst offender in this module -- at pool.max + concurrency, real
 * Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_contractor_bill_Consumers } from "../src/modules/contractor-bill/f3-consumer.js";
import { hrmsContractors, hrmsContractorBills } from "../src/modules/contractor-bill/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "c1000000-dead-4000-8000-00000000c0de";
const ACTOR = "c1000000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

describe("contractor-bill consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent contractor_bill_routes__4 (approve) commands drain without deadlocking the connection pool`,
    async () => {
      const billIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const contractorId = randomUUID();
        const billId = randomUUID();
        billIds.push(billId);
        // Distinct contractor per bill: each bill's advisory lock/YTD lookup
        // must key on its own contractor so 13 concurrent approvals do not
        // serialize against each other for an unrelated reason.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) =>
          tx.insert(hrmsContractors).values({
            id: contractorId, tenantId: TENANT, name: `Test Contractor ${i}`,
            contractorKind: "other", createdBy: ACTOR, updatedBy: ACTOR,
          }),
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) =>
          tx.insert(hrmsContractorBills).values({
            id: billId, tenantId: TENANT, contractorId,
            billNo: `BILL-${billId.slice(0, 8)}`, billDate: "2026-09-01",
            grossMinor: 5_000_000n, gstApplicable: false,
            status: "submitted", createdBy: ACTOR, updatedBy: ACTOR,
          }),
        );
      }

      const q = tenantWrappedQueue();
      registerF3_contractor_bill_Consumers(q);
      await q.start();

      await Promise.all(billIds.map((billId) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "contractor_bill_routes__4", tenantId: TENANT,
          params: { billId }, body: {},
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);

      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- assert the DLQ is empty so a silent per-command failure
      // can't hide behind a "drained" result.
      expect(q.dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify(q.dlq)}`).toHaveLength(0);

      for (const billId of billIds) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = await withTenantScope(db, TENANT, (tx: any) =>
          tx.select().from(hrmsContractorBills)
            .where(and(eq(hrmsContractorBills.tenantId, TENANT), eq(hrmsContractorBills.id, billId))),
        );
        const row = rows[0];
        expect(row?.status).toBe("approved");
        expect(row?.netPayableMinor).toBeGreaterThan(0n);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
