/**
 * crm-service mergeAccounts nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: mergeAccounts (contacts/merge-consumer.ts) called
 * mergeRepo.findActiveAccountRow TWICE (once for the primary account, once
 * for the duplicate) -- a scopedRead-based function that opens its OWN
 * db.transaction() -- from INSIDE its own already-open outer
 * db.transaction(). This is a genuine multiple-scopedRead-calls-per-
 * invocation case, and was missed in the first pass of the PR that added
 * the sibling fix for mergeLeads findActiveRow a few lines above it in
 * the same file -- caught by independent review. Same shape as
 * notification-service (#1028), building-service (#1035), payroll-service
 * (#1042, #1048), finance-service (#1043), hrms-service (#1045, #1047),
 * grant-service (#1049), billing-service (#1050), inspection-service
 * (#1052, #1055, #1056, #1057, #1059, #1060, #1061, #1062), and
 * asset-service (#1063).
 *
 * Fixed by routing onto findActiveAccountRowTx, reading through the
 * callers already-open tx.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerMergeConsumers } from "../src/modules/contacts/merge-consumer.js";
import { accounts } from "../src/modules/contacts/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "acc00000-dead-4000-8000-00000000acc0";
const ACTOR = "acc00000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("crm-service mergeAccounts -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent mergeAccounts commands (each merging two real active accounts) drain without deadlocking the connection pool",
    async () => {
      const pairs: Array<{ primaryId: string; duplicateId: string }> = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const primaryId = randomUUID();
        const duplicateId = randomUUID();
        await runWithTenant(TENANT, async () => {
          await db.transaction(async (tx) => {
            await tx.insert(accounts).values([
              { id: primaryId, tenantId: TENANT, name: "Primary " + randomUUID(), createdBy: ACTOR, updatedBy: ACTOR },
              { id: duplicateId, tenantId: TENANT, name: "Duplicate " + randomUUID(), createdBy: ACTOR, updatedBy: ACTOR },
            ]);
          });
        });
        pairs.push({ primaryId, duplicateId });
      }

      const q = new MemoryQueue();
      registerMergeConsumers(q);
      await q.start();

      await Promise.all(pairs.map(({ primaryId, duplicateId }) =>
        q.publish(COMMANDS.mergeAccounts, makeMsg(COMMANDS.mergeAccounts, {
          primaryId, duplicateId, tenantId: TENANT,
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
