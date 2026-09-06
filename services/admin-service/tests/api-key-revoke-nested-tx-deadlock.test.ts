/**
 * admin-service apiKeyRevoke nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: the apiKeyRevoke command handler (api-keys/consumer.ts) opens
 * db.transaction() and calls repo.revokeKey(id, tenantId, actorId) -- a
 * function that opened its own db.transaction() internally (a raw
 * db.transaction(), not the scopedRead/tenantTransaction helper names, but
 * the identical bug shape) from INSIDE the already-open outer transaction.
 * Real api-key revocation under concurrent load is a realistic trigger --
 * e.g. a bulk key-rotation policy revoking many keys at once.
 *
 * Fixed by routing onto revokeKeyTx, reading and writing through the
 * already-open transaction passed in by the caller.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerApiKeyConsumers } from "../src/modules/api-keys/consumer.js";
import { adminApiKeys } from "../src/modules/api-keys/schema.js";
import { COMMANDS } from "../src/topics.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";

const TENANT = "a91c0000-dead-4000-8000-0000000a91c0";
const ACTOR = "a91c0000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("admin-service apiKeyRevoke -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent apiKeyRevoke commands (each against a real seeded active key) drain without deadlocking the connection pool",
    async () => {
      const keyIds: string[] = [];
      await runWithTenant(TENANT, async () => {
        await db.transaction(async (tx) => {
          for (let i = 0; i < CONCURRENCY; i++) {
            const id = randomUUID();
            keyIds.push(id);
            await tx.insert(adminApiKeys).values({
              id, tenantId: TENANT, keyName: "Revoke Test Key " + randomUUID(),
              keyPrefix: "ak_test_" + i, keyHash: randomUUID(),
              createdBy: ACTOR, updatedBy: ACTOR,
            });
          }
        });
      });

      const q = tenantScoped(new MemoryQueue());
      registerApiKeyConsumers(q);
      await q.start();

      await Promise.all(keyIds.map((id) =>
        q.publish(COMMANDS.apiKeyRevoke, makeMsg(COMMANDS.apiKeyRevoke, { id, tenantId: TENANT })),
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
