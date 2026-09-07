/**
 * hrms-service gpf module nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: gpf_routes__1 (subscription/advance/withdrawal/refund posting,
 * f3-consumer.ts) called scopedRead-based repo.findAccountByEmployee from
 * INSIDE its own already-open outer db.transaction() -- a second
 * transaction competing for a connection from the same pool as the outer
 * one (the subsequent `lockedBalance`/`insertLedger`/`bumpAccountVersion`
 * calls already correctly read/write through the caller's tx), deadlocking
 * every in-flight command once concurrency reaches pool.max.
 *
 * Fixed by routing findAccountByEmployee onto findAccountByEmployeeTx
 * (repo.ts), reading through the caller's already-open tx. This test
 * exercises gpf_routes__1 (monthly subscription posting -- the GPF
 * ledger's bread-and-butter write) at pool.max + concurrency, real
 * Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_gpf_Consumers } from "../src/modules/gpf/f3-consumer.js";
import { hrmsGpfAccounts, hrmsGpfLedger } from "../src/modules/gpf/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "c5000000-dead-4000-8000-00000000c0de";
const ACTOR = "c5000000-dead-4000-8000-0000000ac70a";
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

describe("gpf consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent gpf_routes__1 (subscription posting) commands drain without deadlocking the connection pool`,
    async () => {
      const employeeIds: string[] = [];
      const ledgerIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const accountId = randomUUID();
        const employeeId = randomUUID();
        employeeIds.push(employeeId);
        ledgerIds.push(randomUUID());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) =>
          tx.insert(hrmsGpfAccounts).values({
            id: accountId, tenantId: TENANT, employeeId,
            gpfNumber: `GPF-${accountId.slice(0, 8)}`,
            openingBalanceMinor: 0n, monthlySubscriptionMinor: 100000n,
            status: "active", createdBy: ACTOR, updatedBy: ACTOR,
          }),
        );
      }

      const q = tenantWrappedQueue();
      registerF3_gpf_Consumers(q);
      await q.start();

      await Promise.all(employeeIds.map((employeeId, i) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "gpf_routes__1", tenantId: TENANT, id: ledgerIds[i],
          entryType: "subscription", sign: 1,
          params: { id: employeeId },
          body: { amountMinor: 100000 },
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

      for (const employeeId of employeeIds) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ledgerRows = await withTenantScope(db, TENANT, (tx: any) =>
          tx.select().from(hrmsGpfLedger)
            .where(and(eq(hrmsGpfLedger.tenantId, TENANT), eq(hrmsGpfLedger.employeeId, employeeId))),
        );
        expect(ledgerRows).toHaveLength(1);
        expect(ledgerRows[0].entryType).toBe("subscription");
        expect(ledgerRows[0].balanceMinor).toBe(100000n);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const acctRows = await withTenantScope(db, TENANT, (tx: any) =>
          tx.select().from(hrmsGpfAccounts)
            .where(and(eq(hrmsGpfAccounts.tenantId, TENANT), eq(hrmsGpfAccounts.employeeId, employeeId))),
        );
        expect(acctRows[0].version).toBe(2);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
