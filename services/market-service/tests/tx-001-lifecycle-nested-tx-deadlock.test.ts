/**
 * TX-001 (market-service slice) -- lifecycle module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep (evidence
 * column cited `market lifecycle:213`) and confirmed by an independent
 * manual scan of every db.transaction() block in this service (all four
 * consumer.ts files across allotments/billing/lifecycle/properties -- 14
 * db.transaction blocks total), plus scan_nested_tx_v2.py -- exactly 1
 * genuine site, matching the evidence column exactly:
 *
 *   1. `repo.findById(p.id, msg.tenantId)`  (lifecycle/consumer.ts:213, completeRequest)
 *
 * lifecycle/repo.ts's findById() is defined via this service's `scopedRead()`
 * helper (src/shared/db.ts), which is a bare `db.transaction(fn)` -- i.e.
 * this bare read repo function already opens its OWN transaction, same
 * failure shape as every other TX-001 fix in this campaign. Called from
 * INSIDE completeRequest's already-open outer db.transaction() (to look up
 * the request before flipping the target allotment's status), it needs a
 * second, nested pool connection. Under pool.max concurrent in-flight
 * consumer transactions, no second connection is ever free and the whole
 * queue deadlocks silently forever.
 *
 * This test drives completeRequest (market.lifecycle.complete) at
 * pool.max + 3 concurrency, real Postgres, real pool, many different
 * lifecycle requests (each against a DIFFERENT allotment, so there is no
 * legitimate same-row contention to confound the deadlock signal) completing
 * at once -- a realistic trigger (e.g. a batch eviction/cancellation sweep
 * run by an ULB admin). Fixed by routing the read onto
 * repo.findByIdTx(tx, ...), reading through the caller's already-open tx
 * instead of opening a second one.
 *
 * Sabotage check (see PR body): reverting the call site back to the bare
 * findById() reproduces the drain timeout below.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { marketAllotments } from "../src/modules/allotments/schema.js";
import { marketLifecycleRequests } from "../src/modules/lifecycle/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerLifecycleConsumers } from "../src/modules/lifecycle/consumer.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "7a161000-dead-4000-8000-00000000ca12";
const OFFICER = "7a161000-dead-4000-8000-0000000ac70a";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly this test DB's connection style
// (vitest.config.ts has no DB_VIA_PGBOUNCER set). +3 to clear it.
const CONCURRENCY = 13;

function makeMsg(requestId: string) {
  return {
    messageId: randomUUID(), type: COMMANDS.completeRequest, tenantId: TENANT,
    actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id: requestId, tenantId: TENANT },
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      // _inbox.processed has no tenantId column (just messageId + processedAt) --
      // messageIds here are always fresh randomUUID()s per test run, so there
      // is nothing of this tenant's to clean there (same as parking-service's
      // TX-001 deadlock test precedent).
      await tx.delete(marketLifecycleRequests).where(eq(marketLifecycleRequests.tenantId, TENANT));
      await tx.delete(marketAllotments).where(eq(marketAllotments.tenantId, TENANT));
    }),
  );
}

let allotmentIds: string[] = [];
let requestIds: string[] = [];

beforeAll(async () => {
  await clean();
  allotmentIds = Array.from({ length: CONCURRENCY }, () => randomUUID());
  requestIds = Array.from({ length: CONCURRENCY }, () => randomUUID());
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      for (const [i, allotmentId] of allotmentIds.entries()) {
        await tx.insert(marketAllotments).values({
          id: allotmentId, tenantId: TENANT, allotmentNumber: `MKT/TX001/${i}`,
          propertyId: randomUUID(), allotteeName: `TX-001 Deadlock Fixture Allottee ${i}`,
          allotmentType: "direct", status: "agreement_signed",
          currency: "INR", createdBy: OFFICER, updatedBy: OFFICER,
        });
        await tx.insert(marketLifecycleRequests).values({
          id: requestIds[i], tenantId: TENANT, allotmentId,
          requestNumber: `MKT-LC/TX001/${i}`, requestType: "cancellation", status: "approved",
          reason: "TX-001 deadlock fixture", approvedBy: OFFICER,
          createdBy: OFFICER, updatedBy: OFFICER,
        });
      }
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("lifecycle consumer completeRequest -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent completeRequest commands across different lifecycle requests/allotments drain without deadlocking the connection pool`,
    async () => {
      const q = tenantScoped(new MemoryQueue());
      registerLifecycleConsumers(q);
      await q.start();

      await Promise.all(requestIds.map((id) => q.publish(COMMANDS.completeRequest, makeMsg(id))));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);
      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-tx pool deadlock regressed`).toBe(false);
      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- assert the DLQ is empty so a silent per-command failure
      // isn't masked by a "drained" queue.
      expect((q as MemoryQueue).dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify((q as MemoryQueue).dlq)}`).toHaveLength(0);
      await q.stop();

      const requests = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(marketLifecycleRequests).where(inArray(marketLifecycleRequests.id, requestIds))),
      );
      expect(requests).toHaveLength(CONCURRENCY);
      for (const row of requests) {
        expect(row.status, `lifecycle request ${row.id} did not complete`).toBe("completed");
      }

      const allotments = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(marketAllotments).where(inArray(marketAllotments.id, allotmentIds))),
      );
      expect(allotments).toHaveLength(CONCURRENCY);
      for (const row of allotments) {
        // Proves the fix didn't just avoid the deadlock but that the nested
        // read (finding the request before deriving the target allotment
        // status) actually landed correctly for every concurrent handler --
        // every allotment really transitioned to "cancelled", the
        // requestType "cancellation" target status.
        expect(row.status, `allotment ${row.id} did not transition`).toBe("cancelled");
      }
    },
    { timeout: 20_000 },
  );
});
