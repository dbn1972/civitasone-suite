/**
 * cdp-service identityUnlink nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: the identityUnlink command handler (identity/consumer.ts)
 * opens db.transaction() and called repo.findById -- a scopedRead-based
 * function that opens its own db.transaction() -- from INSIDE the
 * already-open outer transaction.
 *
 * Fixed by routing onto findByIdTx, reading through the already-open
 * transaction passed in by the caller.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerIdentityConsumers } from "../src/modules/identity/consumer.js";
import { identityGraph } from "../src/modules/identity/schema.js";
import { profiles } from "../src/modules/profiles/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "1de70000-dead-4000-8000-00001de70000";
const ACTOR = "1de70000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: randomUUID(), correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("cdp-service identityUnlink -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent identityUnlink commands (each a real seeded identity link) drain without deadlocking the connection pool",
    async () => {
      const linkIds: string[] = [];
      await runWithTenant(TENANT, async () => {
        await db.transaction(async (tx) => {
          const profileId = randomUUID();
          await tx.insert(profiles).values({
            id: profileId, tenantId: TENANT, createdBy: ACTOR, updatedBy: ACTOR,
          });
          for (let i = 0; i < CONCURRENCY; i++) {
            const id = randomUUID();
            linkIds.push(id);
            await tx.insert(identityGraph).values({
              id, tenantId: TENANT, profileId, identifierType: "email",
              identifierHash: "hash-" + randomUUID(), createdBy: ACTOR, updatedBy: ACTOR,
            });
          }
        });
      });

      const q = new MemoryQueue();
      registerIdentityConsumers(q);
      await q.start();

      await Promise.all(linkIds.map((id) =>
        q.publish(COMMANDS.identityUnlink, makeMsg(COMMANDS.identityUnlink, { id, tenantId: TENANT })),
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
