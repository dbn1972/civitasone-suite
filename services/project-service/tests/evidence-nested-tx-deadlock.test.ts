/**
 * TX-001 (project-service slice) — evidence module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep (independently
 * re-verified with scan_nested_tx_v2.py plus a manual trace of every
 * db.transaction()/tenantTransaction() block in project-service): the
 * evidence module's evidenceAttach consumer called
 * projectRepo.findMilestoneById(id, tenantId) — a db.transaction()-based
 * read that opens its OWN transaction — from INSIDE an already-open outer
 * db.transaction() in the consumer. Under pool.max concurrent in-flight
 * consumer transactions, every one of them needs a second ("nested") pool
 * connection at the same moment none is free, deadlocking the whole queue
 * silently forever.
 *
 * This test exercises evidenceAttach (project.evidence.attach) at
 * pool.max + 3 concurrency, real Postgres, real pool, several officers
 * attaching different evidence files to the SAME milestone at once (a
 * realistic trigger — a batch of supporting documents uploaded together
 * ahead of a milestone review).
 *
 * Fixed by routing onto the existing findMilestoneByIdTx(tx, ...) sibling,
 * reading through the caller's already-open tx (board-intake's sibling
 * regression test, board-intake-nested-tx-deadlock.test.ts, covers the
 * other TX-001 site fixed in this same PR — this test closes the gap that
 * left the evidence-module fix without its own regression coverage).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { projectProjects, projectMilestones, projectMilestoneEvidence } from "../src/modules/project/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerEvidenceConsumers } from "../src/modules/evidence/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "e11dec00-dead-4000-8000-0000000e11de";
const OFFICER = "e11dec00-dead-4000-8000-0000000ac70a";
const MILESTONE_ID = randomUUID();
const PROJECT_ID = randomUUID();
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;

/**
 * Test-harness fix: `new MemoryQueue()` used directly (not the production
 * `createQueue()` factory) does NOT auto-wrap subscribed handlers with
 * `withTenantConsumer`. Mirror production wiring here (same pattern as
 * board-intake's sibling regression test).
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function makeMsg(id: string, payload: Record<string, unknown>) {
  return {
    messageId: id, type: COMMANDS.evidenceAttach, tenantId: TENANT,
    actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(projectMilestoneEvidence).where(eq(projectMilestoneEvidence.tenantId, TENANT));
      await tx.delete(projectMilestones).where(eq(projectMilestones.tenantId, TENANT));
      await tx.delete(projectProjects).where(eq(projectProjects.tenantId, TENANT));
    }),
  );
}

const evidenceIds = Array.from({ length: CONCURRENCY }, () => randomUUID());

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(projectProjects).values({
        id: PROJECT_ID,
        tenantId: TENANT,
        code: "TX-001-FIXTURE",
        name: "TX-001 deadlock fixture project",
        createdBy: OFFICER,
        updatedBy: OFFICER,
      });
      await tx.insert(projectMilestones).values({
        id: MILESTONE_ID,
        projectId: PROJECT_ID,
        tenantId: TENANT,
        name: "TX-001 deadlock fixture milestone",
        plannedDate: "2026-12-31",
        createdBy: OFFICER,
        updatedBy: OFFICER,
      });
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("evidence consumer evidenceAttach -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent evidenceAttach commands (distinct files, same milestone) drain without deadlocking the connection pool",
    async () => {
      const q = wireTenantAwareQueue(new MemoryQueue());
      registerEvidenceConsumers(q);
      await q.start();

      await Promise.all(evidenceIds.map((id, i) =>
        q.publish(COMMANDS.evidenceAttach, makeMsg(randomUUID(), {
          id, tenantId: TENANT, milestoneId: MILESTONE_ID,
          fileName: `evidence-${i}.pdf`, fileUrl: `s3://fixtures/evidence-${i}.pdf`, fileType: "application/pdf",
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);
      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- assert the DLQ is empty so a silent per-command failure
      // (e.g. every command timing out on the pool and erroring out) isn't
      // masked by a "drained" queue.
      expect((q as MemoryQueue).dlq, "handler errors were swallowed into the DLQ: " + JSON.stringify((q as MemoryQueue).dlq)).toHaveLength(0);

      const rows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(projectMilestoneEvidence).where(inArray(projectMilestoneEvidence.id, evidenceIds))),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        expect(row.milestoneId).toBe(MILESTONE_ID);
        expect(row.uploadedBy).toBe(OFFICER);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
