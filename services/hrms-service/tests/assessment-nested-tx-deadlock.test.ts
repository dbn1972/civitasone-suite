/**
 * hrms-service assessment module nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: assessment/f3-consumer.ts's "assessment_routes__7" (start
 * attempt) and "assessment_routes__8" (grade attempt) cases called the
 * scopedRead-based repo.countAttempts / repo.getAttempt / repo.getAssessment
 * / repo.getBank / repo.listQuestions from INSIDE their own already-open
 * outer db.transaction() -- a second transaction competing for a connection
 * from the same pool as the outer one, deadlocking every in-flight command
 * once concurrency reaches pool.max. Same shape as hrms-service's own
 * leave/contracts modules and 20+ other services audited under this skill.
 *
 * This test exercises "assessment_routes__7" (start attempt), which calls
 * countAttempts -- the simplest of the five affected functions to set up,
 * and enough to prove the fix (routing onto countAttemptsTx, reading
 * through the caller's tx) actually avoids the deadlock at pool.max + 3
 * concurrency, real Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_assessment_Consumers } from "../src/modules/assessment/f3-consumer.js";
import { assessments, attempts, questionBanks } from "../src/modules/assessment/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "a0000000-dead-4000-8000-00000000c0de";
const ACTOR = "a0000000-dead-4000-8000-0000000ac70a";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX). +3 to clear it.
const CONCURRENCY = 13;

/** Mirrors worker.ts's global subscribe wrap: every handler runs under the
 *  message's tenant GUC so FORCE RLS reads/writes succeed, exactly like production. */
function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

async function seedPublishedAssessment(): Promise<string> {
  const assessmentId = randomUUID();
  const bankId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(questionBanks).values({
    id: bankId, tenantId: TENANT, title: "Test Bank", createdBy: ACTOR,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(assessments).values({
    id: assessmentId, tenantId: TENANT, title: "Test Assessment", bankId,
    passingScore: "50", durationMins: 30, maxAttempts: 3, status: "published",
    createdBy: ACTOR,
  }));
  return assessmentId;
}

describe("assessment consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent assessment_routes__7 (start attempt) commands drain without deadlocking the connection pool`,
    async () => {
      const assessmentIds: string[] = [];
      const attemptIds: string[] = [];
      const employeeId = randomUUID();
      for (let i = 0; i < CONCURRENCY; i++) {
        assessmentIds.push(await seedPublishedAssessment());
        attemptIds.push(randomUUID());
      }

      const q = tenantWrappedQueue();
      registerF3_assessment_Consumers(q);
      await q.start();

      await Promise.all(assessmentIds.map((assessmentId, i) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "assessment_routes__7",
          id: attemptIds[i],
          tenantId: TENANT,
          params: { id: assessmentId },
          body: { employeeId },
        })),
      ));

      // The bug's failure mode is queue.drain() never resolving (every
      // in-flight transaction blocked on an unavailable connection forever),
      // so the proof this test needs is that drain() resolves at all within
      // a generous-but-bounded window.
      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);
      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- a test that only checks drain() can pass even though
      // every single command silently failed inside the handler.
      expect(q.dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify(q.dlq)}`).toHaveLength(0);

      // Prove real DB state, not just "didn't hang": every attempt row was
      // actually inserted with attemptNo 1 (first attempt for each employee
      // on its own assessment).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await withTenantScope(db, TENANT, (tx: any) =>
        tx.select().from(attempts).where(eq(attempts.employeeId, employeeId)),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        expect(row.attemptNo).toBe(1);
        expect(row.status).toBe("in_progress");
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
