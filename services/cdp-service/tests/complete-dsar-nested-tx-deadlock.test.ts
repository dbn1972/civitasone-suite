/**
 * cdp-service completeDsar nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: the completeDsar command handler (dsar/consumer.ts) opens
 * db.transaction() and called repo.findById -- a scopedRead-based function
 * that opens its own db.transaction() -- from INSIDE the already-open outer
 * transaction. A bulk DSAR-completion sweep processing many requests at
 * once is a realistic trigger.
 *
 * Fixed by routing onto findByIdTx, reading through the already-open
 * transaction passed in by the caller.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerDsarConsumers } from "../src/modules/dsar/consumer.js";
import { dsarRequests } from "../src/modules/dsar/schema.js";
import { profiles } from "../src/modules/profiles/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "d5a20000-dead-4000-8000-0000d5a20000";
const CONCURRENCY = 13; // pool.max (10) + 3

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: randomUUID(), correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("cdp-service completeDsar -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent completeDsar commands (each a real seeded in-progress request) drain without deadlocking the connection pool",
    async () => {
      const dsarIds: string[] = [];
      await runWithTenant(TENANT, async () => {
        await db.transaction(async (tx) => {
          const profileId = randomUUID();
          await tx.insert(profiles).values({
            id: profileId, tenantId: TENANT, createdBy: "d5a20000-dead-4000-8000-0000000ac70a", updatedBy: "d5a20000-dead-4000-8000-0000000ac70a",
          });
          for (let i = 0; i < CONCURRENCY; i++) {
            const id = randomUUID();
            dsarIds.push(id);
            await tx.insert(dsarRequests).values({
              id, tenantId: TENANT, profileId, requestType: "erasure",
              status: "in_progress", version: 1,
            });
          }
        });
      });

      const q = new MemoryQueue();
      registerDsarConsumers(q);
      await q.start();

      await Promise.all(dsarIds.map((dsarId) =>
        q.publish(COMMANDS.completeDsar, makeMsg(COMMANDS.completeDsar, { dsarId, version: 1 })),
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
