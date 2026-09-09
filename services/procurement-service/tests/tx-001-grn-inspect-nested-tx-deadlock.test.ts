/**
 * TX-001 (procurement-service slice) — additional site found by direct code
 * review while fixing this service's gap-report-evidenced sites (not itself
 * in the gap report's evidence column for procurement, which names only
 * three-way-match/consumer.ts and vendor-blacklist/consumer.ts): grn/
 * consumer.ts's `inspectGrn` (shared by COMMANDS.grnAccept / grnReject) had
 * two bare, non-tx reads sitting inside its already-open db.transaction(),
 * discovered directly beneath its OWN correctly-tx-scoped reads
 * (findGrnByIdTx, findGrnItemsByGrnTx — DOM-002's fix already got those
 * right):
 *
 *   const po = await findPoById(poId, tenantId);
 *   const poItems = await findPoItemsByPoId(poId, tenantId);
 *
 * Same nested-transaction pool-exhaustion shape as three-way-match's four
 * sites and TX-002/TX-003. Fixed by routing both through findPoByIdTx /
 * findPoItemsByPoIdTx (the same new/existing *Tx siblings three-way-match's
 * fix uses).
 *
 * This test exercises the real grnAccept path (registerGrnConsumers) at
 * pool.max + 3 concurrency, real Postgres, real pool.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Handler } from "@civitasone/queue";
import { runWithTenant, withTenantScope, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { registerGrnConsumers } from "../src/modules/grn/consumer.js";
import { procurementGrns, procurementGrnItems, procurementInspections } from "../src/modules/grn/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT   = "8c8c8c8c-3003-4000-8000-0000000000f1";
const RECEIVER = randomUUID();
const INSPECTOR = randomUUID();
const VENDOR   = randomUUID();
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX); +3 clears it.
const CONCURRENCY = 13;

function wire(q: MemoryQueue): MemoryQueue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}

function msg(type: string, payload: Record<string, unknown>, actorId: string) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

async function cleanup() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementInspections).where(eq(procurementInspections.tenantId, TENANT));
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

describe("grn consumer (inspectGrn) — nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent grnAccept commands (each with its own PO/GRN) drain without deadlocking the pool, and all persist accepted`,
    async () => {
      await cleanup();

      const q = wire(new MemoryQueue());
      registerGrnConsumers(q);
      await q.start();

      const grnIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const poId = randomUUID();
        const poItemId = randomUUID();
        const grnId = randomUUID();
        grnIds.push(grnId);

        await withTenantScope(db, TENANT, (tx: any) => tx.insert(procurementPos).values({
          id: poId, tenantId: TENANT, poNo: `PO-TX001-GRN-${i}`, vendorId: VENDOR,
          indentRef: `IND-${i}`, status: "approved", totalMinor: 50_000n,
          createdBy: RECEIVER, updatedBy: RECEIVER,
        }));
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(procurementPoItems).values({
          id: poItemId, poId, tenantId: TENANT, itemCode: `ITEM-${i}`, description: "test item",
          quantity: 5, unitPriceMinor: 5_000n, createdBy: RECEIVER, updatedBy: RECEIVER,
        }));

        // Land the GRN in under_inspection through the real grnCreate flow
        // (same helper style as tests/dom-002-grn-guards.test.ts), so the
        // subsequent grnAccept exercises the genuine state machine.
        await q.publish(COMMANDS.grnCreate, msg(COMMANDS.grnCreate, {
          id: grnId, tenantId: TENANT, grnNo: `GRN-TX001-${i}`,
          poRef: `procurement_po:${poId}`, vendorId: VENDOR,
          items: [{ poItemRef: poItemId, itemCode: `ITEM-${i}`, orderedQty: 5, receivedQty: 5, acceptedQty: 5, unit: "nos" }],
        }, RECEIVER));
      }
      await q.drain();

      for (const grnId of grnIds) {
        const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
          tx.select().from(procurementGrns).where(eq(procurementGrns.id, grnId))));
        expect(rows[0]?.status, `GRN ${grnId} did not land in under_inspection via grnCreate`).toBe("under_inspection");
      }

      // Now the actual regression target: CONCURRENCY simultaneous
      // grnAccept commands, each running inspectGrn's db.transaction(),
      // each of which used to make two bare (non-tx) reads inside it.
      await Promise.all(grnIds.map((grnId) =>
        q.publish(COMMANDS.grnAccept, msg(COMMANDS.grnAccept, { id: grnId, tenantId: TENANT }, INSPECTOR)),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);
      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms — nested-transaction pool deadlock regressed`).toBe(false);
      await q.stop();

      for (const grnId of grnIds) {
        const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
          tx.select().from(procurementGrns).where(eq(procurementGrns.id, grnId))));
        expect(rows[0]?.status, `GRN ${grnId} was not accepted`).toBe("accepted");
      }
    },
    { timeout: 25_000 },
  );
});
