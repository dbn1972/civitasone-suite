/**
 * inspection-service illegalConstructionInspect nested-transaction
 * connection-pool deadlock regression. Found via
 * .claude/skills/16-production-readiness-audit.md section 1, on a re-scan
 * after fixing a scanner limitation: the illegalConstructionInspect command
 * handler (illegal-construction/consumer.ts) -- and its sibling actionIssue/
 * enforce handlers in the same file -- opens db.transaction() and called
 * findCaseById / findActionById -- cache-wrapped, scopedRead-based functions
 * that each open their OWN db.transaction() -- from INSIDE the already-open
 * outer transaction.
 *
 * Fixed by routing onto findCaseByIdTx / findActionByIdTx, reading through
 * the caller's already-open tx (and deliberately bypassing the
 * read-through cache).
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerIllegalConstructionConsumers } from "../src/modules/illegal-construction/consumer.js";
import { illegalConstructionCases } from "../src/modules/illegal-construction/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "111ec000-dead-4000-8000-0000111ec000";
const ACTOR = "111ec000-dead-4000-8000-0000000ac70a";
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

describe("inspection-service illegalConstructionInspect -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent illegalConstructionInspect commands (each a real seeded case) drain without deadlocking the connection pool`,
    async () => {
      const caseIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const id = randomUUID();
        caseIds.push(id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(illegalConstructionCases).values({
          id, tenantId: TENANT, caseNumber: "ILC-DEADLOCK-" + i + "-" + randomUUID().slice(0, 8),
          reportedBy: ACTOR, location: { lat: 0, lng: 0 }, ownerName: "Test Owner",
          violationType: "no_permit", description: "test case",
          status: "reported", createdBy: ACTOR, updatedBy: ACTOR,
        }));
      }

      const q = tenantWrappedQueue();
      registerIllegalConstructionConsumers(q);
      await q.start();

      await Promise.all(caseIds.map((caseId) =>
        q.publish(COMMANDS.illegalConstructionInspect, makeMsg(COMMANDS.illegalConstructionInspect, {
          caseId, inspectionFindings: { notes: "test finding" },
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
