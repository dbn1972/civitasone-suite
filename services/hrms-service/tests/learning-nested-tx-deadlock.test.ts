/**
 * hrms-service learning module nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: learning/f3-consumer.ts's "learning_routes__10" (enrollment
 * progress PATCH by enrollment id) called the scopedRead-based
 * repo.getEnrollmentById from INSIDE its own already-open outer
 * db.transaction() -- a second transaction competing for a connection from
 * the same pool as the outer one, deadlocking every in-flight command once
 * concurrency reaches pool.max.
 *
 * (Note: a scan for `repo.getModule`/`repo.getLesson`/`repo.getEnrollment`
 * also matched this file, but those three only appear inside comments
 * documenting what routes.ts does -- not as real calls; cases __4 and __6
 * already read the module/lesson/enrollment rows directly off `tx`. Only
 * getEnrollmentById was a genuine hit, fixed by routing onto
 * getEnrollmentByIdTx.)
 *
 * This test exercises "learning_routes__10" at pool.max + 3 concurrency,
 * real Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_learning_Consumers } from "../src/modules/learning/f3-consumer.js";
import { enrollments } from "../src/modules/learning/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "c0000000-dead-4000-8000-00000000c0de";
const ACTOR = "c0000000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

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

async function seedEnrollment(): Promise<string> {
  const enrollmentId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(enrollments).values({
    id: enrollmentId, tenantId: TENANT, courseId: randomUUID(), employeeId: randomUUID(),
    status: "in_progress", progressPct: 40,
  }));
  return enrollmentId;
}

describe("learning consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent learning_routes__10 (enrollment progress PATCH) commands drain without deadlocking the connection pool`,
    async () => {
      const enrollmentIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        enrollmentIds.push(await seedEnrollment());
      }

      const q = tenantWrappedQueue();
      registerF3_learning_Consumers(q);
      await q.start();

      await Promise.all(enrollmentIds.map((enrollmentId) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "learning_routes__10",
          id: enrollmentId,
          tenantId: TENANT,
          params: { id: enrollmentId },
          body: { percentComplete: 100 },
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);
      expect(q.dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify(q.dlq)}`).toHaveLength(0);

      // Prove real DB state, not just "didn't hang": every enrollment was
      // actually updated to completed (100%), not left at its seeded value.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await withTenantScope(db, TENANT, (tx: any) =>
        tx.select().from(enrollments).where(eq(enrollments.tenantId, TENANT)),
      );
      const updated = rows.filter((r: { id: string }) => enrollmentIds.includes(r.id));
      expect(updated).toHaveLength(CONCURRENCY);
      for (const row of updated) {
        expect(row.progressPct).toBe(100);
        expect(row.status).toBe("completed");
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
