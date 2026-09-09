/**
 * TX-001 (procurement-service slice) — regression test for the nested-
 * transaction connection-pool deadlock in three-way-match/consumer.ts, the
 * worst site in this service's TX-001 evidence (4 nested reads per message):
 *
 *   poRepo.findPoById(p.poId, p.tenantId)          -- opened its OWN nested
 *   grnRepo.findGrnById(p.grnId)                       db.transaction() from
 *   poRepo.findPoItemsByPoId(p.poId, p.tenantId)       inside this consumer's
 *   grnRepo.findGrnItemsByGrnId(p.grnId)               already-open outer tx
 *
 * With pool.max concurrent outer transactions in flight (each holding a
 * connection for the whole handler), every one of them needing FOUR extra
 * ("nested") pool connections at the same moment none is free deadlocks the
 * pool silently forever — exactly the shape fixed for finance-service's
 * bank-recon consumer (see services/finance-service/tests/nested-tx-deadlock.test.ts,
 * the established pattern this file follows) and for procurement-service's
 * own TX-002/TX-003.
 *
 * Fix: all four reads now go through their *Tx siblings (findPoByIdTx,
 * findGrnByIdTx, findPoItemsByPoIdTx [new], findGrnItemsByGrnTx), sharing the
 * outer transaction's connection instead of checking out their own.
 *
 * This test exercises the real threeWayMatchRun consumer at pool.max + 3
 * concurrency, real Postgres, real pool, real MemoryQueue — proving the fix
 * actually avoids the deadlock (not just that unit-level mocks are satisfied)
 * — and additionally asserts every message's derived three_way_match row was
 * actually persisted (state correctness, not just "drain didn't hang").
 *
 * Sabotage check (see PR body): reverting any one of the four call sites back
 * to its bare (non-Tx) form reproduces the drain timeout below.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { registerThreeWayMatchConsumers } from "../src/modules/three-way-match/consumer.js";
import { threeWayMatch } from "../src/modules/three-way-match/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { procurementGrns, procurementGrnItems } from "../src/modules/grn/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "7a7a7a7a-3001-4000-8000-0000000000f1";
const ACTOR = randomUUID();
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) against a
// direct (non-pgbouncer) DATABASE_URL, exactly this test's connection style.
// +3 to clear it — matches finance-service's nested-tx-deadlock.test.ts and
// the gap report's own explicit fix-verification guidance for TX-001.
const CONCURRENCY = 13;

type Seed = { poId: string; grnId: string; poItemId: string; runId: string };
const seeds: Seed[] = [];

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
    messageId: randomUUID(), type: COMMANDS.threeWayMatchRun, tenantId: TENANT,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

async function cleanup() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(threeWayMatch).where(eq(threeWayMatch.tenantId, TENANT));
    await tx.delete(procurementGrnItems).where(eq(procurementGrnItems.tenantId, TENANT));
    await tx.delete(procurementGrns).where(eq(procurementGrns.tenantId, TENANT));
    await tx.delete(procurementPoItems).where(eq(procurementPoItems.tenantId, TENANT));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
  }));
}

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("three-way-match consumer — nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent procurement.three_way_match.run commands drain without deadlocking the pool, and all persist correctly`,
    async () => {
      await cleanup();

      for (let i = 0; i < CONCURRENCY; i++) {
        const poId = randomUUID();
        const grnId = randomUUID();
        const poItemId = randomUUID();
        const runId = randomUUID();
        seeds.push({ poId, grnId, poItemId, runId });

        await withTenantScope(db, TENANT, (tx: any) => tx.insert(procurementPos).values({
          id: poId, tenantId: TENANT, poNo: `PO-TX001-${i}`, vendorId: randomUUID(),
          indentRef: `IND-${i}`, totalMinor: 100_000n, status: "approved",
          createdBy: ACTOR, updatedBy: ACTOR,
        }));
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(procurementPoItems).values({
          id: poItemId, poId, tenantId: TENANT, itemCode: `ITEM-${i}`, description: "test item",
          quantity: 10, unitPriceMinor: 10_000n, createdBy: ACTOR, updatedBy: ACTOR,
        }));
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(procurementGrns).values({
          id: grnId, tenantId: TENANT, grnNo: `GRN-TX001-${i}`, poRef: `procurement_po:${poId}`,
          vendorId: randomUUID(), status: "accepted", createdBy: ACTOR, updatedBy: ACTOR,
        }));
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(procurementGrnItems).values({
          id: randomUUID(), grnId, tenantId: TENANT, poItemRef: poItemId, itemCode: `ITEM-${i}`,
          orderedQty: 10, receivedQty: 10, acceptedQty: 10, createdBy: ACTOR, updatedBy: ACTOR,
        }));
      }

      const q = tenantWrappedQueue();
      registerThreeWayMatchConsumers(q);
      await q.start();

      await Promise.all(seeds.map((s) =>
        q.publish(COMMANDS.threeWayMatchRun, makeMsg({
          id: s.runId, tenantId: TENANT, poId: s.poId, grnId: s.grnId,
        })),
      ));

      // The bug's failure mode is queue.drain() never resolving — every
      // in-flight transaction blocked on an unavailable connection forever —
      // so the proof needed is that drain() resolves at all within a
      // generous-but-bounded window.
      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms — nested-transaction pool deadlock regressed`).toBe(false);
      await q.stop();

      // State correctness: every message must have actually persisted its
      // derived three_way_match row, not just "not hung".
      const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
        tx.select().from(threeWayMatch).where(eq(threeWayMatch.tenantId, TENANT))));
      expect(rows).toHaveLength(CONCURRENCY);
      for (const s of seeds) {
        const row = rows.find((r) => r.id === s.runId);
        expect(row, `three_way_match row missing for run ${s.runId}`).toBeDefined();
        expect(row?.matchStatus).toBe("matched");
      }
    },
    { timeout: 20_000 },
  );
});
