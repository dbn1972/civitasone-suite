/**
 * workflow-service castCommitteeVote nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1, on a re-scan after fixing a scanner limitation (an
 * object-literal return-type union like
 * `Promise<VoteResult | { notFound: true }>` was hiding the real function
 * body from the earlier pass, which had only caught the sibling
 * createCommitteeDecision in this same repo file): the castCommitteeVote
 * command handler (quorum/consumer.ts) opens db.transaction() and called
 * repo.castVote -- a function that opened its OWN db.transaction()
 * internally -- from INSIDE the already-open outer transaction. A committee
 * casting many votes in quick succession (e.g. all members voting at once
 * near a deadline) is a realistic trigger.
 *
 * Fixed by routing onto castVoteTx, reading and writing through the
 * already-open transaction passed in by the caller.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerQuorumConsumers } from "../src/modules/quorum/consumer.js";
import { committeeDecisions } from "../src/modules/quorum/schema.js";
import { COMMANDS } from "../src/topics.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";

const TENANT = "ca57000e-dead-4000-8000-0000000ca570";
const ACTOR = "ca57000e-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("workflow-service castCommitteeVote -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent castCommitteeVote commands (each a real seeded open decision) drain without deadlocking the connection pool",
    async () => {
      const decisionIds: string[] = [];
      await runWithTenant(TENANT, async () => {
        await db.transaction(async (tx) => {
          for (let i = 0; i < CONCURRENCY; i++) {
            const id = randomUUID();
            decisionIds.push(id);
            await tx.insert(committeeDecisions).values({
              id, tenantId: TENANT, subject: "Vote Test " + i, rule: "majority",
              totalMembers: 5, status: "open", createdBy: ACTOR,
            });
          }
        });
      });

      const q = tenantScoped(new MemoryQueue());
      registerQuorumConsumers(q);
      await q.start();

      await Promise.all(decisionIds.map((id) =>
        q.publish(COMMANDS.castCommitteeVote, makeMsg(COMMANDS.castCommitteeVote, {
          id, tenantId: TENANT, vote: "approve", reason: null,
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
