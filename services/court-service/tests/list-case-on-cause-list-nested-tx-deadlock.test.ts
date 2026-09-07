/**
 * court-service listCaseOnCauseList nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: the listCaseOnCauseList command handler (cause-list/consumer.ts)
 * opens db.transaction() and called repo.getCauseList -- a scopedRead-based
 * function that opens its own db.transaction() -- from INSIDE the
 * already-open outer transaction. A bulk cause-list build (listing many
 * cases onto a single day cause list at once) is a realistic trigger.
 *
 * Fixed by routing onto getCauseListTx, reading through the already-open
 * transaction passed in by the caller.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerCauseListConsumers } from "../src/modules/cause-list/consumer.js";
import { causeLists } from "../src/modules/cause-list/schema.js";
import { courts } from "../src/modules/court-registry/schema.js";
import { COMMANDS } from "../src/topics.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";

const TENANT = "ca050000-dead-4000-8000-0000ca050000";
const ACTOR = "ca050000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("court-service listCaseOnCauseList -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent listCaseOnCauseList commands (each onto its own real seeded cause list) drain without deadlocking the connection pool",
    async () => {
      const causeListIds: string[] = [];
      await runWithTenant(TENANT, async () => {
        await db.transaction(async (tx) => {
          const courtId = randomUUID();
          await tx.insert(courts).values({
            id: courtId, tenantId: TENANT, name: "Deadlock Test Court",
            courtType: "district", createdBy: ACTOR, updatedBy: ACTOR,
          });
          for (let i = 0; i < CONCURRENCY; i++) {
            const id = randomUUID();
            causeListIds.push(id);
            await tx.insert(causeLists).values({
              id, tenantId: TENANT, courtId, listDate: "2026-12-31",
              status: "draft", createdBy: ACTOR, updatedBy: ACTOR,
            });
          }
        });
      });

      const q = tenantScoped(new MemoryQueue());
      registerCauseListConsumers((topic, handler) => q.subscribe(topic, handler));
      await q.start();

      await Promise.all(causeListIds.map((causeListId, i) =>
        q.publish(COMMANDS.listCaseOnCauseList, makeMsg(COMMANDS.listCaseOnCauseList, {
          id: randomUUID(), tenantId: TENANT, causeListId, caseId: randomUUID(),
          itemNumber: i + 1, slot: "slot-" + i, courtroom: "CR-" + i,
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
