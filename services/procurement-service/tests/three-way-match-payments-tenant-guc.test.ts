/**
 * Regression test — grn/repo.ts's hasMatchedThreeWayWithInvoice() ran a raw
 * `db.execute(sql\`...\`)` against procurement.three_way_match (FORCE ROW
 * LEVEL SECURITY) with no db.transaction()/tenant-GUC wrapper: the exact
 * "bare raw query against a FORCE-RLS table, no tenant GUC set" shape fixed
 * 65+ times elsewhere in this campaign (payroll-service, hrms-service — see
 * packages/db/src/raw-tenant-guc.ts's doc comment for the general defect,
 * and #1625-#1628 for the same species in payroll/hrms).
 *
 * Every sibling read in this exact file (findGrnById, findGrnItemsByGrnId,
 * findInspectionByGrnId, countAcceptedGrnsByPoRef) is wrapped in
 * db.transaction() specifically so this service's wrapWithTenantGuc wrapper
 * (packages/db/src/wrap-tenant-db.ts, applied in shared/db.ts via
 * createTenantDb) injects `SET LOCAL app.tenant_id` before the read runs —
 * hasMatchedThreeWayWithInvoice was the one missed instance.
 *
 * Because FORCE RLS fails CLOSED (see raw-tenant-guc.ts's own doc comment),
 * this bug does NOT leak cross-tenant data — it makes the check see ZERO
 * rows always, so payments/consumer.ts's validateThreeWayMatch() permanently
 * blocks a legitimate advance/debit-note payment for ANY tenant with a real,
 * correctly-matched invoice on file (THREE_WAY_MATCH_REQUIRED, forever).
 * Confirmed against a real Postgres before writing the fix (see PR
 * description for the before/after run transcript — sabotage-then-restore
 * discipline per campaign convention).
 *
 * Reproduced end-to-end through the REAL payments consumer (real Postgres,
 * real RLS, real MemoryQueue, no mocks) rather than by calling
 * hasMatchedThreeWayWithInvoice in isolation, because the observable
 * production symptom is "a payment that should be released gets blocked" —
 * that is what this test proves, both broken and fixed.
 *
 * The PO is created through the REAL po/consumer.ts poCreate handler against
 * a real approved indent with headroom, so this also confirms PR #1630
 * (indent-budget enforcement) does not itself block a legitimate PO — the
 * prerequisite a prior investigating sweep could not get past. The GRN
 * (header row only — nothing on this code path reads GRN items) and the
 * three_way_match row are seeded directly via Drizzle + withTenantScope,
 * mirroring this service's own tx-001-three-way-match-nested-tx-deadlock
 * .test.ts convention, since deriving them through the three-way-match
 * consumer's own invoice-recording flow is orthogonal to the bug under test.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { CommandOutcome } from "@civitasone/queue-service";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { registerPoConsumers } from "../src/modules/po/consumer.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { procurementIndents } from "../src/modules/indent/schema.js";
import { procurementPos } from "../src/modules/po/schema.js";
import { procurementGrns } from "../src/modules/grn/schema.js";
import { threeWayMatch } from "../src/modules/three-way-match/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID(); // cross-tenant isolation check
const ACTOR = randomUUID();

// Rs 500 PO (< the Rs 1,000 SANCTION_REQUIRED_ABOVE_MINOR gate in
// po/consumer.ts) so this fixture never needs a sanctionRef / a live
// finance-service — keeps this test scoped to the indent-budget + tenant-GUC
// gates that are actually relevant here.
const ITEM_UNIT_PRICE_MINOR = 10_000;
const ITEM_QTY = 5;
const PO_TOTAL_MINOR = BigInt(ITEM_UNIT_PRICE_MINOR) * BigInt(ITEM_QTY);

function tenantWrappedQueueWithOutcomes(outcomes: CommandOutcome[]): MemoryQueue {
  const q = new MemoryQueue();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawSubscribe = (q as any).subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>, options?: any) =>
    rawSubscribe(
      topic,
      (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)),
      { ...options, onOutcome: async (o: CommandOutcome) => { outcomes.push(o); await options?.onOutcome?.(o); } },
    );
  return q;
}

async function seedApprovedIndent(tenant: string, totalMinor: bigint): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, tenant, (tx: any) => tx.insert(procurementIndents).values({
    id, tenantId: tenant, indentNo: `IND-GUC-${id.slice(0, 8)}`,
    department: "test-dept", purpose: "three-way-match tenant-GUC regression fixture",
    totalMinor, committedMinor: 0n, status: "approved",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return id;
}

async function cleanupTenant(tenant: string): Promise<void> {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.delete(threeWayMatch).where(eq(threeWayMatch.tenantId, tenant));
    await tx.delete(procurementGrns).where(eq(procurementGrns.tenantId, tenant));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, tenant));
    await tx.delete(procurementIndents).where(eq(procurementIndents.tenantId, tenant));
  }));
}

afterAll(async () => {
  await cleanupTenant(TENANT_A);
  await cleanupTenant(TENANT_B);
  await sqlClient.end();
});

/**
 * Real PO (via the real poCreate consumer, against a real approved indent
 * with headroom) + a directly-seeded accepted GRN + a directly-seeded
 * matched-with-invoice three_way_match row, all for `tenant`. Returns the PO id.
 */
async function seedRealChain(tenant: string): Promise<{ poId: string }> {
  const indentId = await seedApprovedIndent(tenant, 10_000_00n); // Rs 10,000 headroom

  const poOutcomes: CommandOutcome[] = [];
  const poQueue = tenantWrappedQueueWithOutcomes(poOutcomes);
  registerPoConsumers(poQueue);
  await poQueue.start();

  const poId = randomUUID();
  await poQueue.publish(COMMANDS.poCreate, {
    type: COMMANDS.poCreate, tenantId: tenant, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: {
      id: poId, tenantId: tenant, poNo: `PO-GUC-${poId.slice(0, 8)}`,
      vendorId: randomUUID(), indentRef: indentId,
      items: [{ itemCode: "ITEM-1", description: "test item", quantity: ITEM_QTY, unit: "nos", unitPriceMinor: ITEM_UNIT_PRICE_MINOR }],
    },
  });
  await poQueue.drain();
  await poQueue.stop();

  expect(poOutcomes, "seed PO command produced no outcome — fixture broken, not the bug under test").toHaveLength(1);
  expect(poOutcomes[0].status, `PO seed was rejected/failed, not created: ${JSON.stringify(poOutcomes[0])}`).toBe("succeeded");

  // Confirm the PO actually persisted — i.e. PR #1630's indent-budget gate
  // genuinely evaluated and passed, not merely "didn't throw".
  const poRows = await runWithTenant(tenant, () => db.transaction((tx) =>
    tx.select().from(procurementPos).where(eq(procurementPos.id, poId))));
  expect(poRows, "PO row missing after poCreate reported success").toHaveLength(1);
  expect(poRows[0]?.totalMinor).toBe(PO_TOTAL_MINOR);

  const grnId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, tenant, (tx: any) => tx.insert(procurementGrns).values({
    id: grnId, tenantId: tenant, grnNo: `GRN-GUC-${grnId.slice(0, 8)}`,
    poRef: `procurement_po:${poId}`, vendorId: randomUUID(), status: "accepted",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, tenant, (tx: any) => tx.insert(threeWayMatch).values({
    id: randomUUID(), tenantId: tenant, poId, grnId,
    invoiceId: randomUUID(), matchStatus: "matched",
    poAmountMinor: PO_TOTAL_MINOR, grnAmountMinor: PO_TOTAL_MINOR, invoiceAmountMinor: PO_TOTAL_MINOR,
    autoMatched: true,
  }));

  return { poId };
}

describe("payments/consumer.ts validateThreeWayMatch -- hasMatchedThreeWayWithInvoice tenant-GUC fix", () => {
  it("releases an advance for a real, correctly-matched PO+GRN+invoice chain (was: always THREE_WAY_MATCH_REQUIRED)", async () => {
    const { poId } = await seedRealChain(TENANT_A);

    const outcomes: CommandOutcome[] = [];
    const queue = tenantWrappedQueueWithOutcomes(outcomes);
    registerPaymentsConsumers(queue);
    await queue.start();

    await queue.publish(COMMANDS.advanceCreate, {
      type: COMMANDS.advanceCreate, tenantId: TENANT_A, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        id: randomUUID(), tenantId: TENANT_A, poRef: `procurement_po:${poId}`,
        vendorId: randomUUID(), amountMinor: 10_000, advanceType: "mobilisation",
      },
    });
    await queue.drain();
    await queue.stop();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status, `advanceCreate outcome: ${JSON.stringify(outcomes[0])}`).toBe("succeeded");
  });

  it("tenant B's own matched PO/GRN/invoice does not let tenant A's payment through on tenant B's tenantId, and vice-versa (cross-tenant isolation)", async () => {
    // Tenant B gets its OWN real, fully-matched chain — if the fix ever
    // regressed to "sees ANY matched row" instead of "sees only THIS
    // tenant's matched row", this is what would catch it.
    await seedRealChain(TENANT_B);
    const { poId: poIdA } = await seedRealChain(TENANT_A);

    const outcomes: CommandOutcome[] = [];
    const queue = tenantWrappedQueueWithOutcomes(outcomes);
    registerPaymentsConsumers(queue);
    await queue.start();

    // Tenant A's own payment against its own PO — must succeed on its own data.
    await queue.publish(COMMANDS.advanceCreate, {
      type: COMMANDS.advanceCreate, tenantId: TENANT_A, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        id: randomUUID(), tenantId: TENANT_A, poRef: `procurement_po:${poIdA}`,
        vendorId: randomUUID(), amountMinor: 10_000, advanceType: "mobilisation",
      },
    });
    // Same PO id, but submitted AS TENANT B — tenant B has no GRN/match row
    // for tenant A's PO, so this must be rejected, never borrow tenant A's
    // match to let it through.
    await queue.publish(COMMANDS.advanceCreate, {
      type: COMMANDS.advanceCreate, tenantId: TENANT_B, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        id: randomUUID(), tenantId: TENANT_B, poRef: `procurement_po:${poIdA}`,
        vendorId: randomUUID(), amountMinor: 10_000, advanceType: "mobilisation",
      },
    });
    await queue.drain();
    await queue.stop();

    expect(outcomes).toHaveLength(2);
    const outA = outcomes.find((o) => o.tenantId === TENANT_A);
    const outBWrongPo = outcomes.find((o) => o.tenantId === TENANT_B);
    expect(outA?.status, `tenant A's own payment: ${JSON.stringify(outA)}`).toBe("succeeded");
    expect(outBWrongPo?.status, `tenant B against tenant A's PO must be rejected, not succeed (cross-tenant leak): ${JSON.stringify(outBWrongPo)}`).toBe("rejected");
    expect(outBWrongPo?.reason).toContain("THREE_WAY_MATCH_REQUIRED");
  });
});
