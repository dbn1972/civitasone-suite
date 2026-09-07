/**
 * inspection-service surveyUpdate nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1, on a re-scan after fixing a scanner limitation: the
 * surveyUpdate command handler (survey/consumer.ts) -- and its siblings
 * activate/close/responseSubmit/aggregate in the same file -- opens
 * db.transaction() and called findSurveyById / findResponsesBySurvey --
 * cache-wrapped, scopedRead-based functions that each open their OWN
 * db.transaction() -- from INSIDE the already-open outer transaction.
 *
 * Fixed by routing onto findSurveyByIdTx / findResponsesBySurveyTx, reading
 * through the caller's already-open tx (and deliberately bypassing the
 * read-through cache for findSurveyById).
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerSurveyConsumers } from "../src/modules/survey/consumer.js";
import { surveyDefinitions } from "../src/modules/survey/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "5c722000-dead-4000-8000-00005c722000";
const ACTOR = "5c722000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("inspection-service surveyUpdate -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent surveyUpdate commands (each a real seeded draft survey) drain without deadlocking the connection pool`,
    async () => {
      const surveyIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const id = randomUUID();
        surveyIds.push(id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(surveyDefinitions).values({
          id, tenantId: TENANT, title: "Deadlock Test Survey " + i,
          targetEntityType: "entity", questionnaire: [{ id: "q1", question: "test?", fieldType: "text" }],
          samplingMethod: "random", sampleSizePercent: "10.00",
          status: "draft", version: 1, createdBy: ACTOR, updatedBy: ACTOR,
        }));
      }

      const q = tenantWrappedQueue();
      registerSurveyConsumers(q);
      await q.start();

      await Promise.all(surveyIds.map((surveyId) =>
        q.publish(COMMANDS.surveyUpdate, makeMsg(COMMANDS.surveyUpdate, {
          surveyId, version: 1, title: "Updated title",
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
