/**
 * hrms-service rti f3-consumer nested-transaction connection-pool deadlock
 * regression (TX-001).
 *
 * Found during the TX-001 final fleet-wide closure sweep: hrms-service had
 * already been swept for this bug class (21 pre-existing
 * `*-nested-tx-deadlock.test.ts` files cover deputation, learning, leave,
 * etc.), but the `rti` module -- an `// @ts-nocheck` generated F3 leftover
 * consumer, like the others -- was missed. `repo.transitionRti()` takes no
 * `tx` parameter and opens its own `db.transaction()` internally; the
 * consumer's `rti_routes__1`..`rti_routes__4` cases all called it directly
 * from INSIDE the already-open outer `db.transaction()` in
 * `f3-consumer.ts`. Under `pool.max` concurrent in-flight rti-transition
 * commands, the outer transaction holds every pool connection waiting on
 * work, and each nested `db.transaction()` call has no free connection to
 * open on -- deadlock.
 *
 * Fixed by adding `transitionRtiTx(tx, ...)` (runs against the caller's
 * already-open transaction, no nested open) and routing all four consumer
 * call sites through it, exactly the `...Tx` sibling pattern used across
 * the rest of this campaign (see e.g. `loyalty-service`'s `findByIdTx`,
 * `estab-service`'s optional-tx-param `upsertBalance`).
 *
 * This test exercises `rti_routes__1` (assign PIO) at pool.max + concurrency,
 * real Postgres, real pool -- no mocks.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_rti_Consumers } from "../src/modules/rti/f3-consumer.js";
import { hrmsRtiRequests } from "../src/modules/rti/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "f0000000-dead-4000-8000-00000000c0de";
const ACTOR = "f0000000-dead-4000-8000-0000000ac70a";
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
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

async function seedRti(): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsRtiRequests).values({
    id, tenantId: TENANT, referenceNo: `RTI-TEST-${id.slice(0, 8)}`,
    applicantName: "Test Applicant", subject: "Test subject", requestText: "Test request text",
    receivedDate: "2027-01-01", dueDate: "2027-01-31", status: "filed",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return id;
}

describe("rti f3-consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent rti_routes__1 (assign PIO) commands drain without deadlocking the connection pool`,
    async () => {
      const seeded: Array<{ id: string; pioId: string }> = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        seeded.push({ id: await seedRti(), pioId: randomUUID() });
      }

      const q = tenantWrappedQueue();
      registerF3_rti_Consumers(q);
      await q.start();

      await Promise.all(seeded.map(({ id, pioId }) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "rti_routes__1", tenantId: TENANT, id, params: { id },
          body: { pioId },
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);
      expect(q.dlq, `dlq should be empty, got: ${JSON.stringify(q.dlq)}`).toHaveLength(0);

      // Real DB state: every rti row transitioned filed -> assigned with the
      // right pioId and a bumped version (proves the fixed transitionRtiTx
      // call actually ran the guarded update, not a no-op).
      for (const { id, pioId } of seeded) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = await withTenantScope(db, TENANT, (tx: any) =>
          tx.select().from(hrmsRtiRequests).where(eq(hrmsRtiRequests.id, id)));
        expect(rows[0]?.status).toBe("assigned");
        expect(rows[0]?.pioId).toBe(pioId);
        expect(rows[0]?.version).toBe(2);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
