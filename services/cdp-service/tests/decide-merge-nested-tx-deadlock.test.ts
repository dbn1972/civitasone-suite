/**
 * cdp-service decideMerge nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: the decideMerge command handler (steward/consumer.ts) opens
 * db.transaction() and called repo.findById -- a scopedRead-based function
 * that opens its own db.transaction() -- from INSIDE the already-open outer
 * transaction. Uses decision=reject to exercise the fix without also
 * requiring the downstream profile-merge machinery.
 *
 * Fixed by routing onto findByIdTx, reading through the already-open
 * transaction passed in by the caller.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerStewardConsumers } from "../src/modules/steward/consumer.js";
import { mergeQueue } from "../src/modules/steward/schema.js";
import { profiles } from "../src/modules/profiles/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "57ea0000-dead-4000-8000-000057ea0000";
const ACTOR = "57ea0000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("cdp-service decideMerge -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent decideMerge (reject) commands (each a real seeded pending merge request) drain without deadlocking the connection pool",
    async () => {
      const mergeIds: string[] = [];
      await runWithTenant(TENANT, async () => {
        await db.transaction(async (tx) => {
          const sourceProfileId = randomUUID();
          const targetProfileId = randomUUID();
          await tx.insert(profiles).values([
            { id: sourceProfileId, tenantId: TENANT, createdBy: ACTOR, updatedBy: ACTOR },
            { id: targetProfileId, tenantId: TENANT, createdBy: ACTOR, updatedBy: ACTOR },
          ]);
          for (let i = 0; i < CONCURRENCY; i++) {
            const id = randomUUID();
            mergeIds.push(id);
            await tx.insert(mergeQueue).values({
              id, tenantId: TENANT, sourceProfileId, targetProfileId,
              confidence: "0.9000", status: "pending", createdBy: ACTOR, updatedBy: ACTOR,
            });
          }
        });
      });

      const q = new MemoryQueue();
      registerStewardConsumers(q);
      await q.start();

      await Promise.all(mergeIds.map((mergeRequestId) =>
        q.publish(COMMANDS.decideMerge, makeMsg(COMMANDS.decideMerge, {
          mergeRequestId, decision: "reject", reason: "test", tenantId: TENANT,
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);

      await q.stop();
    },
    { timeout: 20000 },
  );
});
