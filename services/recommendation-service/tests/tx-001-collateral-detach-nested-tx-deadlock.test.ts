/**
 * TX-001 (recommendation-service slice) — collateral module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep (evidence
 * column cited `collateral:80`): handleDetachCollateral (collateral/consumer.ts)
 * called repo.findById -- a scopedRead()-based read that opens its OWN
 * db.transaction() -- from INSIDE an already-open outer db.transaction(). Under
 * pool.max concurrent in-flight consumer transactions, every one of them needs
 * a second ("nested") pool connection at the same moment none is free,
 * deadlocking the whole queue silently forever.
 *
 * This test exercises handleDetachCollateral (recommendation.collateral.detach)
 * at pool.max + 3 concurrency, real Postgres, real pool, each command detaching
 * a distinct collateral link (avoiding row-lock serialization so the test
 * isolates the pool-connection deadlock specifically).
 *
 * Fixed by routing onto repo.findByIdTx(tx, ...), reading through the
 * caller's already-open tx.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { collateralLinks } from "../src/modules/collateral/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { handleDetachCollateral, type DetachCollateralPayload } from "../src/modules/collateral/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "aef00000-dead-4000-8000-0000000000f3";
const ACTOR = "aef00000-dead-4000-8000-0000000ac70c";
const RECOMMENDATION = "aef00000-dead-4000-8000-0000000000fc";
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

function makeMsg(id: string, payload: DetachCollateralPayload) {
  return {
    messageId: id, type: COMMANDS.collateralDetach, tenantId: TENANT,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(collateralLinks).where(eq(collateralLinks.tenantId, TENANT));
    }),
  );
}

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("collateral consumer handleDetachCollateral -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent collateralDetach commands (one distinct link each) drain without deadlocking the connection pool",
    async () => {
      await clean();
      const linkIds = Array.from({ length: CONCURRENCY }, () => randomUUID());
      await runWithTenant(TENANT, () =>
        db.transaction(async (tx) => {
          for (let i = 0; i < CONCURRENCY; i++) {
            await tx.insert(collateralLinks).values({
              id: linkIds[i], tenantId: TENANT, recommendationId: RECOMMENDATION,
              collateralType: "document", collateralRef: "doc-" + i,
              title: "Collateral " + i, ordinal: i,
              createdBy: ACTOR, updatedBy: ACTOR,
            });
          }
        }),
      );

      const q = wireTenantAwareQueue(new MemoryQueue());
      q.subscribe(COMMANDS.collateralDetach, handleDetachCollateral as Handler);
      await q.start();

      await Promise.all(linkIds.map((id) =>
        q.publish(COMMANDS.collateralDetach, makeMsg(randomUUID(), { linkId: id })),
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
        db.transaction((tx) => tx.select().from(collateralLinks).where(inArray(collateralLinks.id, linkIds))),
      );
      expect(rows, "all collateral links should have been deleted -- a stale/partial row means the detach silently no-op'd instead of genuinely deleting").toHaveLength(0);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
