/**
 * TX-001 (loyalty-service slice) -- redemptions module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep (evidence
 * column cited `loyalty redemptions:87`, confirmed by an independent manual
 * scan of every db.transaction() block across all 5 loyalty-service modules
 * -- exactly 1 genuine site, matching the evidence column exactly, in
 * redemptions/consumer.ts's voidRedemption handler):
 *
 *   1. `enrolmentRepo.findById(p.enrolmentId, msg.tenantId)`  (was line 87)
 *
 * findById() is defined via this service's `scopedRead()` helper
 * (src/shared/db.ts), which is a bare `db.transaction(fn)` -- i.e. every
 * bare read repo function in this service already opens its OWN
 * transaction, same failure shape as estab/procurement/parking's TX-001
 * fixes. Called from INSIDE voidRedemption's already-open outer
 * db.transaction(), it needs a second, nested pool connection. Under
 * pool.max concurrent in-flight consumer transactions, no second connection
 * is ever free and the whole queue deadlocks silently forever.
 *
 * This test drives voidRedemption (loyalty.redemption.void) at pool.max + 3
 * concurrency, real Postgres, real pool, many members voiding independent
 * redemptions at once (a realistic trigger -- e.g. a bulk reward-recall
 * batch). Each command targets its OWN enrolment/redemption pair so there is
 * no legitimate row-level contention to confound the deadlock signal. Fixed
 * by routing the read onto enrolmentRepo.findByIdTx(tx, ...), reading
 * through the caller's already-open tx instead of opening a second one.
 *
 * Sabotage check (see PR body): reverting the call site back to the bare
 * findById() reproduces the drain timeout below.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { programs } from "../src/modules/programs/schema.js";
import { enrolments } from "../src/modules/enrolments/schema.js";
import { redemptions } from "../src/modules/redemptions/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerRedemptionConsumers } from "../src/modules/redemptions/consumer.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "7a161000-dead-4000-8000-0000000ba101";
const ACTOR = "7a161000-dead-4000-8000-0000000ac701";
const PROGRAM = "7a161000-dead-4000-8000-000000000ba9";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly this test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;
const STARTING_BALANCE = 1000n;
const REDEMPTION_POINTS = 100n;

function makeMsg(redemptionId: string, enrolmentId: string) {
  return {
    messageId: randomUUID(),
    type: COMMANDS.voidRedemption,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload: {
      id: redemptionId,
      reason: "TX-001 deadlock regression",
      version: 1,
      enrolmentId,
      points: REDEMPTION_POINTS.toString(),
    },
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      // _inbox.processed has no tenantId column (just messageId + processedAt,
      // see packages/outbox/src/index.ts) -- messageIds here are always fresh
      // randomUUID()s per test run, so there is nothing of this tenant's to
      // clean there (same as estab/parking's TX-001 deadlock test precedent).
      await tx.delete(redemptions).where(eq(redemptions.tenantId, TENANT));
      await tx.delete(enrolments).where(eq(enrolments.tenantId, TENANT));
      await tx.delete(programs).where(eq(programs.tenantId, TENANT));
    }),
  );
}

let enrolmentIds: string[] = [];
let redemptionIds: string[] = [];

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(programs).values({
        id: PROGRAM,
        tenantId: TENANT,
        name: "TX-001 Deadlock Fixture Program",
        status: "active",
        earnRatio: 100n,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });

      enrolmentIds = Array.from({ length: CONCURRENCY }, () => randomUUID());
      redemptionIds = Array.from({ length: CONCURRENCY }, () => randomUUID());

      for (const [i, enrolmentId] of enrolmentIds.entries()) {
        await tx.insert(enrolments).values({
          id: enrolmentId,
          tenantId: TENANT,
          programId: PROGRAM,
          profileId: randomUUID(),
          status: "active",
          tier: "base",
          pointsBalance: STARTING_BALANCE,
          lifetimePoints: STARTING_BALANCE,
          createdBy: ACTOR,
          updatedBy: ACTOR,
          version: 1,
        });
        await tx.insert(redemptions).values({
          id: redemptionIds[i]!,
          tenantId: TENANT,
          enrolmentId,
          points: REDEMPTION_POINTS,
          rewardType: "voucher",
          status: "pending",
          createdBy: ACTOR,
          version: 1,
        });
      }
    }),
  );
});

afterAll(async () => {
  await clean();
  await sqlClient.end();
});

describe("redemptions consumer voidRedemption -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent voidRedemption commands across different enrolments drain without deadlocking the connection pool`,
    async () => {
      const q = tenantScoped(new MemoryQueue());
      registerRedemptionConsumers(q);
      await q.start();

      await Promise.all(
        redemptionIds.map((id, i) => q.publish(COMMANDS.voidRedemption, makeMsg(id, enrolmentIds[i]!))),
      );

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);
      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-tx pool deadlock regressed`).toBe(false);
      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- assert the DLQ is empty so a silent per-command failure
      // (e.g. every command timing out on the pool and erroring out) isn't
      // masked by a "drained" queue.
      expect((q as MemoryQueue).dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify((q as MemoryQueue).dlq)}`).toHaveLength(0);
      await q.stop();

      const redemptionRows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(redemptions).where(inArray(redemptions.id, redemptionIds))),
      );
      expect(redemptionRows).toHaveLength(CONCURRENCY);
      for (const row of redemptionRows) {
        expect(row.status, `redemption ${row.id} was not voided`).toBe("voided");
      }

      const enrolmentRows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(enrolments).where(inArray(enrolments.id, enrolmentIds))),
      );
      expect(enrolmentRows).toHaveLength(CONCURRENCY);
      for (const row of enrolmentRows) {
        // Every enrolment must have had its points genuinely restored --
        // proving the fix didn't just avoid the deadlock but that the nested
        // read (enrolment lookup before the balance adjustment) actually
        // landed correctly for every concurrent handler.
        expect(row.pointsBalance, `enrolment ${row.id} was not credited back`).toBe(STARTING_BALANCE + REDEMPTION_POINTS);
      }
    },
    { timeout: 20_000 },
  );
});
