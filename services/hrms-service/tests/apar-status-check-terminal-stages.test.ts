/**
 * Regression test for the APAR "hrms_appraisals_status_check" schema-drift
 * defect (fixed by migrations/0153_apar_status_check_terminal_stages.sql).
 *
 * Prior to that migration, the CHECK constraint on
 * appraisal.hrms_appraisals.status allowed only 7 of the 10 values the
 * application actually writes -- missing exactly the three APAR-specific
 * terminal stages ('disclosed', 'representation', 'finalised'). Because
 * apar/routes.ts answers its HTTP callers via a synthesized response BEFORE
 * the real write happens (the write is a fire-and-forget f3RouteWrite
 * command processed later by apar/f3-consumer.ts's
 * registerF3_apar_Consumers), POST /v1/hrms/apar/:id/accept returned 200
 * with a plausible body while the async write silently failed every time
 * with:
 *   PostgresError: new row for relation "hrms_appraisals" violates check
 *   constraint "hrms_appraisals_status_check"
 * leaving the row stuck at 'accepting_authority' forever, overall_grade /
 * overall_band permanently NULL, and the downstream representation/finalise
 * endpoints permanently stuck 409 WRONG_STAGE (they were never themselves
 * broken -- the row genuinely never advanced past accepting_authority).
 *
 * apar/f3-consumer.test.ts already asserts (with a MOCKED repo) that the
 * consumer builds the correct { status: "disclosed", ... } patch for
 * apar_routes__4 -- but a mock cannot see a live Postgres CHECK constraint
 * reject that exact patch, which is exactly why that test kept passing
 * throughout this defect's lifetime. This test uses the real Postgres pool
 * (no mocks), the same pattern as apar-nested-tx-deadlock.test.ts, and
 * drives accept -> representation -> finalise end-to-end so the fix is
 * proven at the only layer that could actually catch this: the database.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_apar_Consumers } from "../src/modules/apar/f3-consumer.js";
import { hrmsAppraisals } from "../src/modules/appraisals/schema.js";
import { hrmsAparScores, hrmsAparStageHistory } from "../src/modules/apar/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "e0000000-dead-4000-8000-00000000acc7";
const ACTOR = "e0000000-dead-4000-8000-0000000ac70b";
const DRAIN_TIMEOUT_MS = 10_000;

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

/** Publishes one f3RouteWrite command and waits for the queue to drain it. */
async function publishAndDrain(q: MemoryQueue, payload: Record<string, unknown>): Promise<void> {
  await q.publish(COMMANDS.f3RouteWrite, makeMsg(payload));
  let timedOut = false;
  await Promise.race([
    q.drain(),
    new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
  ]);
  expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms for op ${payload.op}`).toBe(false);
}

async function fetchAppraisal(appraisalId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, TENANT, (tx: any) =>
    tx.select().from(hrmsAppraisals).where(eq(hrmsAppraisals.id, appraisalId)),
  );
  return rows[0];
}

describe("apar consumer -- accept/representation/finalise persist past accepting_authority (real DB, no mocks)", () => {
  it(
    "apar_routes__4 (accept) writes 'disclosed' + computed grade/band, then " +
      "apar_routes__5 (representation) and apar_routes__6 (finalise) each " +
      "genuinely advance the row -- none of them silently no-op against a " +
      "CHECK-constraint rejection",
    async () => {
      const appraisalId = randomUUID();
      const reportingOfficerId = randomUUID();
      const reviewingOfficerId = randomUUID();
      const acceptingAuthorityId = randomUUID();
      const employeeId = randomUUID();

      // Seed the row already at accepting_authority -- the stage immediately
      // before the one this defect blocked -- plus two attribute scores
      // (apar_routes__4 throws NO_SCORES with none, matching the route's own
      // precondition).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await withTenantScope(db, TENANT, async (tx: any) => {
        await tx.insert(hrmsAppraisals).values({
          id: appraisalId, tenantId: TENANT, employeeId, appraisalPeriod: "2026-27",
          status: "accepting_authority",
          reportingOfficerId, reviewingOfficerId, acceptingAuthorityId,
          createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(hrmsAparScores).values([
          { tenantId: TENANT, appraisalId, attribute: "integrity", weight: "1", score: 8,
            scoredBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR },
          { tenantId: TENANT, appraisalId, attribute: "leadership", weight: "1", score: 8,
            scoredBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR },
        ]);
      });

      const q = tenantWrappedQueue();
      registerF3_apar_Consumers(q);
      await q.start();

      // ---- accept: accepting_authority -> disclosed --------------------
      await publishAndDrain(q, {
        op: "apar_routes__4", tenantId: TENANT, params: { id: appraisalId },
        body: { remarks: "accepted, well done" },
      });
      expect(q.dlq, `accept landed in the DLQ: ${JSON.stringify(q.dlq)}`).toHaveLength(0);

      let row = await fetchAppraisal(appraisalId);
      expect(row.status).toBe("disclosed");
      expect(Number(row.overallGrade)).toBe(8);
      expect(row.overallBand).toBe("Very Good");
      expect(row.disclosedAt).toBeTruthy();
      expect(row.acceptingRemarks).toBe("accepted, well done");

      // ---- representation: disclosed -> representation ------------------
      // Previously unreachable: the route correctly 409'd WRONG_STAGE here
      // because the row had never actually left accepting_authority.
      await publishAndDrain(q, {
        op: "apar_routes__5", tenantId: TENANT, params: { id: appraisalId },
        body: { representation: "I would like to appeal the grade" },
      });
      expect(q.dlq, `representation landed in the DLQ: ${JSON.stringify(q.dlq)}`).toHaveLength(0);

      row = await fetchAppraisal(appraisalId);
      expect(row.status).toBe("representation");
      expect(row.representation).toBe("I would like to appeal the grade");

      // ---- finalise: representation -> finalised -------------------------
      await publishAndDrain(q, {
        op: "apar_routes__6", tenantId: TENANT, params: { id: appraisalId }, body: {},
      });
      expect(q.dlq, `finalise landed in the DLQ: ${JSON.stringify(q.dlq)}`).toHaveLength(0);

      row = await fetchAppraisal(appraisalId);
      expect(row.status).toBe("finalised");

      // ---- immutable stage-history: one row per real transition ---------
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const history = await withTenantScope(db, TENANT, (tx: any) =>
        tx.select().from(hrmsAparStageHistory)
          .where(and(eq(hrmsAparStageHistory.tenantId, TENANT), eq(hrmsAparStageHistory.appraisalId, appraisalId))),
      );
      const toStages = history.map((h: { toStage: string }) => h.toStage).sort();
      expect(toStages).toEqual(["disclosed", "finalised", "representation"]);

      await q.stop();
    },
    { timeout: 30_000 },
  );
});
