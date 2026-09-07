/**
 * hrms-service recruitment module nested-transaction connection-pool deadlock
 * regression -- interview/panel path. See
 * .claude/skills/16-production-readiness-audit.md section 1 and
 * requisition-nested-tx-deadlock.test.ts for the full background.
 *
 * This test exercises "recruitment_panel_routes__2" (record interview
 * outcome): panelRepo.findInterviewTx reads the interview (for the
 * optimistic-version guard) from inside the outer transaction, then
 * panelRepo.updateInterview writes the recommendation outcome, at
 * pool.max + 3 concurrency, real Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";
import { hrmsInterviews } from "../src/modules/recruitment/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "d0000000-dead-4000-8000-00000000f0de";
const ACTOR = "d0000000-dead-4000-8000-0000000ac70d";
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

async function seedScheduledInterview(): Promise<string> {
  const interviewId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsInterviews).values({
    id: interviewId, tenantId: TENANT, applicationId: randomUUID(), jobOpeningId: randomUUID(),
    scheduledDate: "2026-10-01", scheduledTime: "10:00", status: "completed",
    createdBy: ACTOR,
  }));
  return interviewId;
}

describe("recruitment consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent recruitment_panel_routes__2 (interview outcome) commands drain without deadlocking the connection pool",
    async () => {
      const interviewIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        interviewIds.push(await seedScheduledInterview());
      }

      const q = tenantWrappedQueue();
      registerF3_recruitment_Consumers(q);
      await q.start();

      await Promise.all(interviewIds.map((interviewId) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "recruitment_panel_routes__2",
          tenantId: TENANT,
          params: { id: interviewId },
          body: { status: "recommended" },
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);
      expect(q.dlq, "handler errors were swallowed into the DLQ: " + JSON.stringify(q.dlq)).toHaveLength(0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await withTenantScope(db, TENANT, (tx: any) =>
        tx.select().from(hrmsInterviews).where(inArray(hrmsInterviews.id, interviewIds)),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        expect(row.outcomeStatus).toBe("recommended");
        expect(row.outcomeBy).toBe(ACTOR);
        expect(row.version).toBe(2);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
