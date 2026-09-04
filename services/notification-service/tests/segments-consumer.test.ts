/**
 * Segments consumer (segments/consumer.ts) — resolveSegment regression test.
 *
 * `resolveSegment`'s handler ran inside `db.transaction(async (tx) => {...})`
 * and looked up the segment via `repo.findSegmentById()`, which is
 * `scopedRead`-based -- opening a SECOND, nested `db.transaction()` on the
 * same connection pool as the outer command. With `pool.max = 10`, once 10
 * `resolveSegment` commands were concurrently in-flight the pool was
 * exhausted and every one of them deadlocked waiting on its own nested
 * lookup (the same shape as `checkQuota`/`checkDlt` in
 * `deliveries/consumer.ts` and `createLocaleVariant` in `i18n/consumer.ts` --
 * see task_477fafd4). Fixed by routing `resolveSegment` onto the caller's
 * already-open `tx` via the new `findSegmentByIdInTx` (see `segments/repo.ts`).
 *
 * This pins the fixed behavior functionally (a single resolveSegment command
 * completes correctly reading through the outer tx, and a not-found segment
 * is still correctly rejected) -- the same style of regression test the
 * checkQuota/checkDlt fix added in tests/channel-quota.test.ts /
 * tests/dlt-validation.test.ts. The pool-exhaustion deadlock itself was
 * reproduced and verified manually against a real Postgres connection pool
 * (before: unfixed code deadlocks past pool.max=10 concurrent resolveSegment
 * commands; after: all commands complete, no idle-in-transaction connections
 * pile up) -- see the PR description for that repro's numbers.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { processed, outboxMessages } from "../src/shared/outbox.js";
import { recipientSegments } from "../src/modules/segments/schema.js";
import { registerSegmentConsumers } from "../src/modules/segments/consumer.js";
import * as repo from "../src/modules/segments/repo.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "5e6d0001-1111-4000-8000-000000000001";
const ACTOR = "5e6daaaa-1111-4000-8000-0000000000aa";

const deliveredMessageIds = new Set<string>();

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(recipientSegments).where(eq(recipientSegments.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
  if (deliveredMessageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...deliveredMessageIds]));
    deliveredMessageIds.clear();
  }
}

async function deliver(
  topic: string,
  messageId: string,
  payload: Record<string, unknown>,
): Promise<MemoryQueue> {
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerSegmentConsumers(q);
  await q.start();
  await q.publish(topic, {
    messageId, type: topic, tenantId: TENANT, actorId: ACTOR,
    correlationId: "corr-seg-1", schemaVersion: "1.0", payload,
  });
  await q.drain();
  return q;
}

async function outboxRowsFor(topic: string) {
  // Filter by BOTH tenant and topic explicitly -- don't rely solely on RLS
  // to scope this query, since this table can be read through tiers that
  // don't enforce it (e.g. the scanner/admin path).
  return runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(outboxMessages).where(and(
      eq(outboxMessages.tenantId, TENANT),
      eq(outboxMessages.topic, topic),
    ))));
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("resolveSegment consumer — nested-transaction regression (task_477fafd4)", () => {
  it("resolves an existing segment by reading through the outer tx (no nested transaction)", async () => {
    const segmentId = randomUUID();
    await runWithTenant(TENANT, () => db.transaction((tx) => repo.insertSegment(tx, {
      id: segmentId,
      tenantId: TENANT,
      name: "premium-tier",
      description: null,
      criteria: { attributes: { tier: "premium" } },
      cachedCount: 42,
      createdBy: ACTOR,
      updatedBy: ACTOR,
      version: 1,
    })));

    const q = await deliver(COMMANDS.resolveSegment, randomUUID(), { segmentId, tenantId: TENANT });

    expect(q.dlq).toHaveLength(0);
    const resolved = await outboxRowsFor(EVENTS.segmentResolved);
    expect(resolved).toHaveLength(1);
    const payload = resolved[0]!.payload as { segmentId: string; recipientCount: number; filters: unknown[] };
    expect(payload.segmentId).toBe(segmentId);
    expect(payload.recipientCount).toBe(42);
    expect(payload.filters).toEqual([{ field: "attr.tier", operator: "eq", value: "premium" }]);
  });

  it("rejects (non-retryably, no crash/deadlock) when the segment does not exist", async () => {
    const missingId = randomUUID();
    const q = await deliver(COMMANDS.resolveSegment, randomUUID(), { segmentId: missingId, tenantId: TENANT });

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toContain("SEGMENT_NOT_FOUND");
    const resolved = await outboxRowsFor(EVENTS.segmentResolved);
    expect(resolved).toHaveLength(0);
  });

  it("findSegmentByIdInTx reads through the caller's already-open transaction", async () => {
    const segmentId = randomUUID();
    // Single already-open tx for both the insert AND the InTx lookup -- proves
    // findSegmentByIdInTx never opens a second transaction on the pool (the
    // fix's core invariant; see repo.ts's findSegmentByIdInTx doc comment).
    const found = await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await repo.insertSegment(tx, {
        id: segmentId,
        tenantId: TENANT,
        name: "in-tx-lookup",
        description: null,
        criteria: { roles: ["admin"] },
        cachedCount: null,
        createdBy: ACTOR,
        updatedBy: ACTOR,
        version: 1,
      });
      return repo.findSegmentByIdInTx(tx, TENANT, segmentId);
    }));

    expect(found?.id).toBe(segmentId);
    expect(found?.name).toBe("in-tx-lookup");
  });
});
