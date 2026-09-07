/**
 * hrms-service apprentice-stipend module nested-transaction connection-pool
 * deadlock regression. Found via
 * .claude/skills/16-production-readiness-audit.md section 1:
 * apprentice_stipend_routes__4 (f3-consumer.ts) called scopedRead-based
 * repo.findStipend and repo.findApprenticeship from INSIDE its own
 * already-open outer db.transaction() -- two nested transactions competing
 * for a connection from the same pool as the outer one, deadlocking every
 * in-flight command once concurrency reaches pool.max.
 *
 * Fixed by routing findStipend/findApprenticeship onto findStipendTx/
 * findApprenticeshipTx (repo.ts), reading through the caller's already-open
 * tx. This test exercises apprentice_stipend_routes__4 (approve) -- the case
 * that chains BOTH fixed reads (findStipend then findApprenticeship) inside
 * one transaction, the worst offender in this module -- at pool.max +
 * concurrency, real Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_apprentice_stipend_Consumers } from "../src/modules/apprentice-stipend/f3-consumer.js";
import { hrmsApprenticeships, hrmsApprenticeStipends } from "../src/modules/apprentice-stipend/schema.js";
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

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

describe("apprentice-stipend consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent apprentice_stipend_routes__4 (approve) commands drain without deadlocking the connection pool`,
    async () => {
      const stipendIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const apprenticeshipId = randomUUID();
        const stipendId = randomUUID();
        stipendIds.push(stipendId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) =>
          tx.insert(hrmsApprenticeships).values({
            id: apprenticeshipId, tenantId: TENANT, apprenticeId: randomUUID(),
            qualification: "iti", monthlyStipendMinor: 1500000n,
            napsReimbPctBps: 2500, napsReimbCapMinor: 150000n,
            trainingStart: "2026-01-01", status: "active",
            createdBy: ACTOR, updatedBy: ACTOR,
          }),
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) =>
          tx.insert(hrmsApprenticeStipends).values({
            id: stipendId, tenantId: TENANT, apprenticeshipId,
            month: "2026-09", workingDays: 26, daysPresent: 26,
            monthlyStipendMinor: 1500000n, napsReimbPctBps: 2500, napsReimbCapMinor: 150000n,
            status: "submitted", createdBy: ACTOR, updatedBy: ACTOR,
          }),
        );
      }

      const q = tenantWrappedQueue();
      registerF3_apprentice_stipend_Consumers(q);
      await q.start();

      await Promise.all(stipendIds.map((stipendId) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "apprentice_stipend_routes__4", tenantId: TENANT,
          params: { stipendId }, body: {},
        })),
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

      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- a test that only checks drain() can pass even though
      // every command silently failed, so assert the DLQ is empty too.
      expect(q.dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify(q.dlq)}`).toHaveLength(0);

      // Confirm real DB state actually landed correctly for every command,
      // not just that the queue drained.
      for (const stipendId of stipendIds) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = await withTenantScope(db, TENANT, (tx: any) =>
          tx.select().from(hrmsApprenticeStipends)
            .where(and(eq(hrmsApprenticeStipends.tenantId, TENANT), eq(hrmsApprenticeStipends.id, stipendId))),
        );
        const row = rows[0];
        expect(row?.status).toBe("approved");
        expect(row?.grossStipendMinor).toBe(1500000n);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
