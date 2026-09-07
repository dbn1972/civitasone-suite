/**
 * inspection-service encroachmentComplaintVerify nested-transaction
 * connection-pool deadlock regression. Found via
 * .claude/skills/16-production-readiness-audit.md section 1, on a re-scan
 * after fixing a scanner limitation: the encroachmentComplaintVerify command
 * handler (encroachment/consumer.ts) -- and its siblings hearing schedule/
 * complete, notice issue/serve/respond, removal order/assign/complete, all
 * in the same file -- opens db.transaction() and called findComplaintById /
 * findNoticeById / findHearingById / findRemovalById -- cache-wrapped,
 * scopedRead-based functions that each open their OWN db.transaction() --
 * from INSIDE the already-open outer transaction.
 *
 * Fixed by routing onto findComplaintByIdTx / findNoticeByIdTx /
 * findHearingByIdTx / findRemovalByIdTx, reading through the caller's
 * already-open tx (and deliberately bypassing the read-through cache).
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerEncroachmentConsumers } from "../src/modules/encroachment/consumer.js";
import { encroachmentComplaints } from "../src/modules/encroachment/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "e17c0000-dead-4000-8000-0000e17c0000";
const ACTOR = "e17c0000-dead-4000-8000-0000000ac70a";
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

describe("inspection-service encroachmentComplaintVerify -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent encroachmentComplaintVerify commands (each a real seeded complaint) drain without deadlocking the connection pool`,
    async () => {
      const complaintIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const id = randomUUID();
        complaintIds.push(id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(encroachmentComplaints).values({
          id, tenantId: TENANT, complaintNumber: "ENC-DEADLOCK-" + i + "-" + randomUUID().slice(0, 8),
          reportedBy: ACTOR, location: { lat: 0, lng: 0, ward: "1", zone: "A" },
          encroachmentType: "footpath_occupation", description: "test complaint",
          status: "received", createdBy: ACTOR, updatedBy: ACTOR,
        }));
      }

      const q = tenantWrappedQueue();
      registerEncroachmentConsumers(q);
      await q.start();

      await Promise.all(complaintIds.map((complaintId) =>
        q.publish(COMMANDS.encroachmentComplaintVerify, makeMsg(COMMANDS.encroachmentComplaintVerify, {
          complaintId, landVerificationReport: { verified: true, surveyNumber: "123/1" },
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
