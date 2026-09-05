/**
 * hrms-service contracts nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: contractActivate/contractTerminate/contractCreate and several
 * other handlers in contracts/consumer.ts called scopedRead-based repo
 * functions (getContractById, getActiveContractForEmployee, and
 * cross-module employeeRepo.findById) from INSIDE their own already-open
 * outer db.transaction() -- a second transaction competing for a
 * connection from the same pool as the outer one, deadlocking every
 * in-flight command once concurrency reaches pool.max. Same shape as
 * notification-service (#1028), building-service (#1035), payroll-service
 * and finance-service (this same audit pass).
 *
 * Fixed by routing every such call site onto a Tx-suffixed variant
 * (getContractByIdTx etc.) reading through the caller's already-open tx.
 * This test exercises contractActivate (the shallowest handler exercising
 * the fix) at pool.max + concurrency, real Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerContractConsumers } from "../src/modules/contracts/consumer.js";
import { hrmsContracts } from "../src/modules/contracts/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "a0000000-dead-4000-8000-00000000c0de";
const ACTOR = "a0000000-dead-4000-8000-0000000ac70a";
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

describe("contracts consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent contractActivate commands drain without deadlocking the connection pool`,
    async () => {
      const contractIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const id = randomUUID();
        contractIds.push(id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) =>
          tx.insert(hrmsContracts).values({
            id, tenantId: TENANT, employeeId: randomUUID(),
            contractNo: `TEST-${id.slice(0, 8)}`, startDate: "2026-01-01", endDate: "2026-12-31",
            status: "draft", createdBy: ACTOR, updatedBy: ACTOR,
          }),
        );
      }

      const q = tenantWrappedQueue();
      registerContractConsumers(q);
      await q.start();

      await Promise.all(contractIds.map((contractId) =>
        q.publish(COMMANDS.contractActivate, makeMsg(COMMANDS.contractActivate, { tenantId: TENANT, contractId })),
      ));

      // The bug's failure mode is queue.drain() never resolving (every
      // in-flight transaction blocked on an unavailable connection
      // forever), so the proof this test needs is that drain() resolves at
      // all within a generous-but-bounded window.
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
