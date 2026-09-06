/**
 * workflow-service deployDecision nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: the deployDecision command handler (decisions/consumer.ts) opens
 * db.transaction() and calls repo.findById(id, tenantId) -- a scopedRead-based
 * function that opens its own db.transaction() -- from INSIDE the already-open
 * outer transaction. A bulk decision-table rollout deploying many draft tables
 * at once is a realistic trigger.
 *
 * Fixed by routing onto findByIdTx, reading through the already-open
 * transaction passed in by the caller.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerDecisionConsumers } from "../src/modules/decisions/consumer.js";
import { decisionTables } from "../src/modules/decisions/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "dec00000-dead-4000-8000-000000dec000";
const ACTOR = "dec00000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("workflow-service deployDecision -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent deployDecision commands (each a real seeded draft table) drain without deadlocking the connection pool",
    async () => {
      const ids: string[] = [];
      await runWithTenant(TENANT, async () => {
        await db.transaction(async (tx) => {
          for (let i = 0; i < CONCURRENCY; i++) {
            const id = randomUUID();
            ids.push(id);
            await tx.insert(decisionTables).values({
              id, tenantId: TENANT, code: "deploy_test_" + randomUUID().slice(0, 8), name: "Deploy Test " + i,
              status: "draft", createdBy: ACTOR, updatedBy: ACTOR,
            });
          }
        });
      });

      const q = new MemoryQueue();
      registerDecisionConsumers(q);
      await q.start();

      await Promise.all(ids.map((id) =>
        q.publish(COMMANDS.deployDecision, makeMsg(COMMANDS.deployDecision, { id, tenantId: TENANT })),
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
