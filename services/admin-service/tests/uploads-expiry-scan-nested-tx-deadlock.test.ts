/**
 * admin-service uploads expiry-scan (f3 op uploads_op_4) nested-transaction
 * connection-pool deadlock regression. Found via
 * .claude/skills/16-production-readiness-audit.md section 1, on a re-scan
 * after fixing a scanner limitation (an object-literal return-type
 * annotation like `Promise<{ rows: X[]; total: number }>` was hiding the
 * real function body from the earlier pass): apply_uploads_4
 * (uploads/doc-f3-apply.ts, the periodic document-expiry scan) opens
 * db.transaction() and called repo.listTypes(tenantId, 200, 0, "active") --
 * a scopedRead-based function that opens its own db.transaction() -- from
 * INSIDE the already-open outer transaction.
 *
 * Fixed by routing onto listTypesTx, reading through the already-open
 * transaction passed in by the caller.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { COMMANDS } from "../src/topics.js";
import { registerF3_uploads_Consumers } from "../src/modules/uploads/doc-f3-consumer.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";

const TENANT = "d0c00000-dead-4000-8000-0000000d0c00";
const ACTOR = "d0c00000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

describe("admin-service uploads expiry-scan (f3 uploads_op_4) -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent f3RouteWrite/uploads_op_4 commands drain without deadlocking the connection pool",
    async () => {
      const q = tenantScoped(new MemoryQueue());
      registerF3_uploads_Consumers(q);
      await q.start();

      await Promise.all(Array.from({ length: CONCURRENCY }, () =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "uploads_op_4", body: { limit: 10 }, params: {}, query: {},
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
