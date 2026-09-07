/**
 * hrms-service apar module nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1.
 *
 * Two genuine hits, one flagged by the scanner and one found only by manual
 * source tracing (the "transitively-nested call via a local helper"
 * sub-pattern documented in the skill -- a scanner that only checks
 * `repo.xxx(...)` calls made textually inside the db.transaction() block
 * misses a call routed through an intermediate local function):
 *
 *  - `repo.listScores` (flagged by the scanner) -- called directly inside
 *    the transaction in apar_routes__3 (reviewing, on a "vary" decision)
 *    and apar_routes__4 (accept + grade).
 *  - `repo.findAppraisal` (NOT flagged -- reached only via the file-local
 *    `mustAppraisal()` closure, defined once above the transaction and
 *    invoked from inside it on every one of apar_routes__1..__6). Every
 *    one of the six stage-transition cases was affected.
 *
 * This test exercises apar_routes__1 (self-appraisal: self_pending ->
 * reporting_officer), the simplest of the six mustAppraisal() call sites,
 * at pool.max + 3 concurrency, real Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_apar_Consumers } from "../src/modules/apar/f3-consumer.js";
import { hrmsAppraisals } from "../src/modules/appraisals/schema.js";
import { hrmsAparStageHistory } from "../src/modules/apar/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "e0000000-dead-4000-8000-00000000c0de";
const ACTOR = "e0000000-dead-4000-8000-0000000ac70a";
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

async function seedSelfPendingAppraisal(): Promise<string> {
  const appraisalId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsAppraisals).values({
    id: appraisalId, tenantId: TENANT, employeeId: randomUUID(), appraisalPeriod: "2026-27",
    status: "self_pending", reportingOfficerId: randomUUID(), reviewingOfficerId: randomUUID(),
    acceptingAuthorityId: randomUUID(), createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return appraisalId;
}

describe("apar consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent apar_routes__1 (self-appraisal) commands drain without deadlocking the connection pool`,
    async () => {
      const appraisalIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        appraisalIds.push(await seedSelfPendingAppraisal());
      }

      const q = tenantWrappedQueue();
      registerF3_apar_Consumers(q);
      await q.start();

      await Promise.all(appraisalIds.map((appraisalId) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "apar_routes__1",
          tenantId: TENANT,
          params: { id: appraisalId },
          body: { selfAppraisal: "self-appraisal text" },
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

      // Prove real DB state, not just "didn't hang": every appraisal moved
      // to reporting_officer with its self-appraisal text recorded, and a
      // stage-history row was appended for each.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await withTenantScope(db, TENANT, (tx: any) =>
        tx.select().from(hrmsAppraisals).where(eq(hrmsAppraisals.tenantId, TENANT)),
      );
      const updated = rows.filter((r: { id: string }) => appraisalIds.includes(r.id));
      expect(updated).toHaveLength(CONCURRENCY);
      for (const row of updated) {
        expect(row.status).toBe("reporting_officer");
        expect(row.selfAppraisal).toBe("self-appraisal text");
        expect(row.version).toBe(2);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const historyRows = await withTenantScope(db, TENANT, (tx: any) =>
        tx.select().from(hrmsAparStageHistory).where(eq(hrmsAparStageHistory.toStage, "reporting_officer")),
      );
      const relevantHistory = historyRows.filter((r: { appraisalId: string }) => appraisalIds.includes(r.appraisalId));
      expect(relevantHistory).toHaveLength(CONCURRENCY);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
