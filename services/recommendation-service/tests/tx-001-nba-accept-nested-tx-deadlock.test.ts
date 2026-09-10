/**
 * TX-001 (recommendation-service slice) — nba module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep (evidence
 * column cited `nba:86`): handleNbaAccept and handleNbaReject (nba/consumer.ts)
 * each called repo.findById -- a scopedRead()-based read that opens its OWN
 * db.transaction() -- from INSIDE an already-open outer db.transaction(). Under
 * pool.max concurrent in-flight consumer transactions, every one of them needs
 * a second ("nested") pool connection at the same moment none is free,
 * deadlocking the whole queue silently forever.
 *
 * This test exercises handleNbaAccept (recommendation.nba.accept) at
 * pool.max + 3 concurrency, real Postgres, real pool, each command accepting a
 * distinct recommendation row (avoiding row-lock serialization so the test
 * isolates the pool-connection deadlock specifically).
 *
 * Fixed by routing onto repo.findByIdTx(tx, ...), reading through the
 * caller's already-open tx. handleNbaReject shares the identical call shape
 * (same repo.findByIdTx site, same outer transaction) and is fixed by the
 * same change -- not separately load-tested here.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { recommendations } from "../src/modules/nba/schema.js";
import { recommendationFeedback } from "../src/modules/feedback/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { handleNbaAccept, type NbaAcceptPayload } from "../src/modules/nba/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "aef00000-dead-4000-8000-0000000000f2";
const ACTOR = "aef00000-dead-4000-8000-0000000ac70b";
const PROFILE = "aef00000-dead-4000-8000-0000000000fd";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function makeMsg(id: string, payload: NbaAcceptPayload) {
  return {
    messageId: id, type: COMMANDS.nbaAccept, tenantId: TENANT,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(recommendationFeedback).where(eq(recommendationFeedback.tenantId, TENANT));
      await tx.delete(recommendations).where(eq(recommendations.tenantId, TENANT));
    }),
  );
}

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("nba consumer handleNbaAccept -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent nbaAccept commands (one distinct recommendation each) drain without deadlocking the connection pool",
    async () => {
      await clean();
      const recIds = Array.from({ length: CONCURRENCY }, () => randomUUID());
      await runWithTenant(TENANT, () =>
        db.transaction(async (tx) => {
          for (let i = 0; i < CONCURRENCY; i++) {
            await tx.insert(recommendations).values({
              id: recIds[i], tenantId: TENANT, profileId: PROFILE,
              recommendationType: "cross_sell", productId: null, channel: "web",
              score: "0.8500", status: "served", servedAt: new Date(),
              createdBy: ACTOR, updatedBy: ACTOR,
            });
          }
        }),
      );

      const q = wireTenantAwareQueue(new MemoryQueue());
      q.subscribe(COMMANDS.nbaAccept, handleNbaAccept as Handler);
      await q.start();

      await Promise.all(recIds.map((id) =>
        q.publish(COMMANDS.nbaAccept, makeMsg(randomUUID(), {
          id, version: 1, feedbackId: randomUUID(),
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);
      expect((q as MemoryQueue).dlq, "handler errors were swallowed into the DLQ: " + JSON.stringify((q as MemoryQueue).dlq)).toHaveLength(0);

      const rows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(recommendations).where(inArray(recommendations.id, recIds))),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const r of rows) {
        expect(r.status, "recommendation " + r.id + " should have been accepted -- a stale status means the accept silently no-op'd instead of genuinely applying").toBe("accepted");
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
