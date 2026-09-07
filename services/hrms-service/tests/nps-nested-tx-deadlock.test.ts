/**
 * hrms-service nps module nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: nps_routes__1 (contribution posting, f3-consumer.ts) called
 * scopedRead-based repo.findAccountByEmployee from INSIDE its own
 * already-open outer db.transaction() -- a second transaction competing
 * for a connection from the same pool as the outer one (the subsequent
 * `lockedBalance`/`insertContribution`/`bumpAccountVersion` calls already
 * correctly read/write through the caller's tx), deadlocking every
 * in-flight command once concurrency reaches pool.max.
 *
 * Fixed by routing findAccountByEmployee onto findAccountByEmployeeTx
 * (repo.ts), reading through the caller's already-open tx. This test
 * exercises nps_routes__1 (monthly contribution posting -- the NPS
 * account's bread-and-butter write) at pool.max + concurrency, real
 * Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_nps_Consumers } from "../src/modules/nps/f3-consumer.js";
import { hrmsNpsAccounts, hrmsNpsContributions } from "../src/modules/nps/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "c4000000-dead-4000-8000-00000000c0de";
const ACTOR = "c4000000-dead-4000-8000-0000000ac70a";
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

describe("nps consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent nps_routes__1 (contribution posting) commands drain without deadlocking the connection pool`,
    async () => {
      const employeeIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const accountId = randomUUID();
        const employeeId = randomUUID();
        employeeIds.push(employeeId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) =>
          tx.insert(hrmsNpsAccounts).values({
            id: accountId, tenantId: TENANT, employeeId,
            // Random (not index-derived) PRAN: this test's DB state accumulates
            // across repeated bare `vitest run` invocations (per the verification
            // discipline in .claude/skills/16-production-readiness-audit.md
            // section 4/6b -- no reset between runs), so a deterministic PRAN
            // would collide with a prior run's row on hrms_nps_accounts_pran_uq.
            pran: `PRAN${randomUUID().replace(/-/g, "").slice(0, 11).toUpperCase()}`, tier: "I",
            openingEmpMinor: 0n, openingErMinor: 0n,
            status: "active", createdBy: ACTOR, updatedBy: ACTOR,
          }),
        );
      }

      const q = tenantWrappedQueue();
      registerF3_nps_Consumers(q);
      await q.start();

      await Promise.all(employeeIds.map((employeeId) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "nps_routes__1", tenantId: TENANT,
          params: { id: employeeId },
          body: { period: "2026-09", empAmountMinor: 100000, erAmountMinor: 140000 },
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
        const contribRows = await withTenantScope(db, TENANT, (tx: any) =>
          tx.select().from(hrmsNpsContributions)
            .where(and(eq(hrmsNpsContributions.tenantId, TENANT), eq(hrmsNpsContributions.employeeId, employeeId))),
        );
        expect(contribRows).toHaveLength(1);
        expect(contribRows[0].entryType).toBe("contribution");
        expect(contribRows[0].balanceMinor).toBe(240000n);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const acctRows = await withTenantScope(db, TENANT, (tx: any) =>
          tx.select().from(hrmsNpsAccounts)
            .where(and(eq(hrmsNpsAccounts.tenantId, TENANT), eq(hrmsNpsAccounts.employeeId, employeeId))),
        );
        expect(acctRows[0].version).toBe(2);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
