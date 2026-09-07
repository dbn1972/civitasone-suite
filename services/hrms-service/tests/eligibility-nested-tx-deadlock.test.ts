/**
 * hrms-service recruitment module nested-transaction connection-pool deadlock
 * regression -- eligibility/screening path. See
 * .claude/skills/16-production-readiness-audit.md section 1 and
 * requisition-nested-tx-deadlock.test.ts for the full background.
 *
 * This test exercises "recruitment_eligibility_routes__1" (apply for a
 * vacancy): eligibilityRepo.findVacancyTx reads the job opening (for its
 * advertised eligibility criteria) from inside the outer transaction, then
 * eligibilityRepo.insertApplication writes the new application, at
 * pool.max + 3 concurrency, real Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";
import { hrmsJobOpenings, hrmsApplications } from "../src/modules/recruitment/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "d0000000-dead-4000-8000-00000000e0de";
const ACTOR = "d0000000-dead-4000-8000-0000000ac70c";
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

async function seedOpenVacancy(): Promise<string> {
  const jobId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsJobOpenings).values({
    id: jobId, tenantId: TENANT, refNo: "REF-" + jobId.slice(0, 8).toUpperCase(),
    title: "Junior Analyst", departmentId: randomUUID(), status: "open",
    eligibility: { allowMultiple: true, minExperienceYears: 0 },
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return jobId;
}

describe("recruitment consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent recruitment_eligibility_routes__1 (apply for vacancy) commands drain without deadlocking the connection pool",
    async () => {
      const jobId = await seedOpenVacancy();

      const q = tenantWrappedQueue();
      registerF3_recruitment_Consumers(q);
      await q.start();

      const appIds = Array.from({ length: CONCURRENCY }, () => randomUUID());

      await Promise.all(appIds.map((appId, i) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "recruitment_eligibility_routes__1",
          tenantId: TENANT,
          id: appId,
          params: { id: jobId },
          body: {
            applicantName: "Test Applicant " + i,
            email: "applicant" + i + "@example.test",
            qualification: "graduate",
            experienceYears: 2,
            dateOfBirth: "1995-01-01",
            category: "general",
          },
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
        tx.select().from(hrmsApplications).where(inArray(hrmsApplications.id, appIds)),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        expect(row.jobOpeningId).toBe(jobId);
        expect(row.status).toBe("active");
        expect(row.stage).toBe("applied");
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
