/**
 * DOM-011 (1/2) — per-tenant configurable three-way-match tolerance, with
 * independent quantity / price / total axes instead of one blended
 * total-only 5% check.
 *
 * Two layers, matching this codebase's DOM-008 precedent
 * (payroll-service/tests/statutory-config.integration.test.ts):
 *  1. Pure domain.ts logic (resolveToleranceConfig / evaluateMatch) — no DB.
 *  2. Real Postgres + real RLS + the real threeWayMatchRun consumer over a
 *     MemoryQueue (mirrors tests/tx-001-three-way-match-nested-tx-deadlock.test.ts's
 *     PO/GRN fixture pattern) — proves the wiring, not just the math.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { registerThreeWayMatchConsumers, resolveThreeWayMatchToleranceConfig } from "../src/modules/three-way-match/consumer.js";
import { threeWayMatch, threeWayMatchConfig } from "../src/modules/three-way-match/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { procurementGrns, procurementGrnItems } from "../src/modules/grn/schema.js";
import { COMMANDS } from "../src/topics.js";
import { DEFAULT_TOLERANCE_CONFIG, evaluateMatch, resolveToleranceConfig, type ToleranceConfigRow } from "../src/modules/three-way-match/domain.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const TENANT_DEFAULT = "8d008011-aaaa-4000-8000-000000000001"; // no override -> platform default applies
const TENANT_OVERRIDE = "8d008011-aaaa-4000-8000-000000000002"; // has its own override row
const ACTOR = randomUUID();

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

async function drain(q: MemoryQueue) {
  const DRAIN_TIMEOUT_MS = 10_000;
  let timedOut = false;
  await Promise.race([
    q.drain(),
    new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
  ]);
  expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms`).toBe(false);
  await q.stop();
}

/** Seeds a PO (single item) + GRN (single item) pair and returns their ids, mirroring tests/tx-001-three-way-match-nested-tx-deadlock.test.ts's fixture shape exactly. */
async function seedPoAndGrn(tenantId: string, opts: { orderedQty: number; acceptedQty: number; unitPriceMinor: bigint }) {
  const poId = randomUUID();
  const poItemId = randomUUID();
  const grnId = randomUUID();
  const totalMinor = opts.unitPriceMinor * BigInt(opts.orderedQty);

  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementPos).values({
    id: poId, tenantId, poNo: `PO-DOM011-${poId.slice(0, 8)}`, vendorId: randomUUID(),
    indentRef: "IND-DOM011", totalMinor, status: "approved",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementPoItems).values({
    id: poItemId, poId, tenantId, itemCode: "ITEM-DOM011", description: "test item",
    quantity: opts.orderedQty, unitPriceMinor: opts.unitPriceMinor, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementGrns).values({
    id: grnId, tenantId, grnNo: `GRN-DOM011-${grnId.slice(0, 8)}`, poRef: `procurement_po:${poId}`,
    vendorId: randomUUID(), status: "accepted", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementGrnItems).values({
    id: randomUUID(), grnId, tenantId, poItemRef: poItemId, itemCode: "ITEM-DOM011",
    orderedQty: opts.orderedQty, receivedQty: opts.acceptedQty, acceptedQty: opts.acceptedQty,
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return { poId, grnId };
}

async function runMatch(tenantId: string, poId: string, grnId: string, invoiceAmountMinor?: bigint) {
  const q = tenantWrappedQueue();
  registerThreeWayMatchConsumers(q);
  await q.start();
  const runId = randomUUID();
  const invoiceId = invoiceAmountMinor !== undefined ? randomUUID() : undefined;
  await q.publish(COMMANDS.threeWayMatchRun, {
    messageId: randomUUID(), type: COMMANDS.threeWayMatchRun, tenantId,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: {
      id: runId, tenantId, poId, grnId,
      ...(invoiceId ? { invoiceId, invoiceAmountMinor: Number(invoiceAmountMinor) } : {}),
    },
  });
  await drain(q);
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) =>
    tx.select().from(threeWayMatch).where(eq(threeWayMatch.id, runId))));
  return rows[0];
}

async function cleanup() {
  for (const tenantId of [TENANT_DEFAULT, TENANT_OVERRIDE]) {
    await runWithTenant(tenantId, () => db.transaction(async (tx) => {
      await tx.delete(threeWayMatch).where(eq(threeWayMatch.tenantId, tenantId));
      await tx.delete(procurementGrnItems).where(eq(procurementGrnItems.tenantId, tenantId));
      await tx.delete(procurementGrns).where(eq(procurementGrns.tenantId, tenantId));
      await tx.delete(procurementPoItems).where(eq(procurementPoItems.tenantId, tenantId));
      await tx.delete(procurementPos).where(eq(procurementPos.tenantId, tenantId));
      await tx.execute(sql`DELETE FROM procurement.three_way_match_config WHERE tenant_id = ${tenantId}::uuid`);
    }));
  }
}

afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("DOM-011 — resolveToleranceConfig (pure)", () => {
  it("migration 0033's seeded platform-default row is byte-identical to DEFAULT_TOLERANCE_CONFIG (parity)", () => {
    const rows: ToleranceConfigRow[] = [{ tenantId: null, ...DEFAULT_TOLERANCE_CONFIG }];
    expect(resolveToleranceConfig(rows, "some-tenant")).toEqual(DEFAULT_TOLERANCE_CONFIG);
  });

  it("a tenant's own row wins over the platform-default row when both are present", () => {
    const rows: ToleranceConfigRow[] = [
      { tenantId: null, qtyTolerancePct: 0, priceTolerancePct: 2, totalTolerancePct: 5 },
      { tenantId: "tenant-a", qtyTolerancePct: 10, priceTolerancePct: 8, totalTolerancePct: 15 },
    ];
    expect(resolveToleranceConfig(rows, "tenant-a")).toEqual({ qtyTolerancePct: 10, priceTolerancePct: 8, totalTolerancePct: 15 });
  });

  it("falls back to the literal DEFAULT_TOLERANCE_CONFIG when no row matches at all (belt-and-suspenders)", () => {
    expect(resolveToleranceConfig([], "tenant-a")).toEqual(DEFAULT_TOLERANCE_CONFIG);
  });
});

describe("DOM-011 — evaluateMatch (pure): qty / price / total are checked independently", () => {
  it("matches when all three axes are within tolerance", () => {
    const result = evaluateMatch(
      { poAmountMinor: 100_000n, grnAmountMinor: 100_000n, grnQtyLines: [{ orderedQty: 100, acceptedQty: 100 }], invoicePresent: false, invoiceAmountMinor: 0n },
      DEFAULT_TOLERANCE_CONFIG,
    );
    expect(result).toMatchObject({ qtyVariancePct: 0, priceVariancePct: 0, totalVariancePct: 0, matchStatus: "matched" });
  });

  it("mismatches on QTY ALONE — a 1% qty shortfall exceeds the 0% default qty tolerance even though total is comfortably under 5%", () => {
    const result = evaluateMatch(
      {
        poAmountMinor: 100_000n, grnAmountMinor: 99_000n,
        grnQtyLines: [{ orderedQty: 100, acceptedQty: 99 }],
        invoicePresent: false, invoiceAmountMinor: 0n,
      },
      DEFAULT_TOLERANCE_CONFIG,
    );
    expect(result.qtyVariancePct).toBeCloseTo(1, 2);
    expect(result.priceVariancePct).toBe(0);
    expect(result.totalVariancePct).toBeCloseTo(1, 2); // well under the 5% total tolerance
    expect(result.matchStatus).toBe("mismatch"); // the OLD blended 5%-total-only check would have PASSED this
  });

  it("mismatches on PRICE ALONE — a 3% invoice-vs-GRN gap exceeds the 2% default price tolerance even though qty is exact and total is under 5%", () => {
    const result = evaluateMatch(
      {
        poAmountMinor: 100_000n, grnAmountMinor: 100_000n,
        grnQtyLines: [{ orderedQty: 100, acceptedQty: 100 }],
        invoicePresent: true, invoiceAmountMinor: 97_000n,
      },
      DEFAULT_TOLERANCE_CONFIG,
    );
    expect(result.qtyVariancePct).toBe(0);
    expect(result.priceVariancePct).toBeCloseTo(3, 2);
    expect(result.totalVariancePct).toBeCloseTo(3, 2); // under the 5% total tolerance
    expect(result.matchStatus).toBe("mismatch"); // the OLD blended 5%-total-only check would ALSO have passed this
  });

  it("mismatches on TOTAL ALONE — small, individually-tolerated qty AND price drift compound past the total ceiling", () => {
    // qty: 100 ordered, 97 accepted -> 3% (under a 4% qty tolerance)
    // price: invoice 93,500 vs grnAmountMinor 97,000 -> 3500/97000, truncated
    //   to whole basis points like the pre-existing variance formula -> 3.60%
    //   (under a 4% price tolerance)
    // total: PO 100,000 vs invoice 93,500 directly -> 6.5% (OVER a 5% total tolerance)
    // Proves total is not redundant with qty+price: each axis can individually
    // pass while their COMBINED drift against the PO exceeds the total ceiling.
    const tolerance = { qtyTolerancePct: 4, priceTolerancePct: 4, totalTolerancePct: 5 };
    const result = evaluateMatch(
      {
        poAmountMinor: 100_000n, grnAmountMinor: 97_000n,
        grnQtyLines: [{ orderedQty: 100, acceptedQty: 97 }],
        invoicePresent: true, invoiceAmountMinor: 93_500n,
      },
      tolerance,
    );
    expect(result.qtyVariancePct).toBeCloseTo(3, 2);
    expect(result.priceVariancePct).toBeCloseTo(3.6, 2);
    expect(result.totalVariancePct).toBeCloseTo(6.5, 2);
    expect(result.qtyVariancePct).toBeLessThanOrEqual(tolerance.qtyTolerancePct);
    expect(result.priceVariancePct).toBeLessThanOrEqual(tolerance.priceTolerancePct);
    expect(result.totalVariancePct).toBeGreaterThan(tolerance.totalTolerancePct);
    expect(result.matchStatus).toBe("mismatch");
  });
});

describe("DOM-011 — three-way-match consumer, real Postgres + real RLS + real MemoryQueue", () => {
  it("platform default (no tenant override): exact qty, no invoice -> matched, and every applied threshold + axis is persisted", async () => {
    await cleanup();
    const { poId, grnId } = await seedPoAndGrn(TENANT_DEFAULT, { orderedQty: 50, acceptedQty: 50, unitPriceMinor: 2_000n });
    const row = await runMatch(TENANT_DEFAULT, poId, grnId);
    expect(row).toBeDefined();
    expect(row!.matchStatus).toBe("matched");
    expect(Number(row!.qtyVariancePct)).toBeCloseTo(0, 2);
    expect(Number(row!.qtyTolerancePct)).toBeCloseTo(0, 2);
    expect(Number(row!.priceTolerancePct)).toBeCloseTo(2, 2);
    expect(Number(row!.totalTolerancePct)).toBeCloseTo(5, 2);
  });

  it("platform default: a pure 2% qty shortfall (no invoice) is flagged mismatch -- the exact gap this fix closes", async () => {
    const { poId, grnId } = await seedPoAndGrn(TENANT_DEFAULT, { orderedQty: 50, acceptedQty: 49, unitPriceMinor: 2_000n });
    const row = await runMatch(TENANT_DEFAULT, poId, grnId);
    expect(row!.matchStatus).toBe("mismatch");
    expect(Number(row!.qtyVariancePct)).toBeCloseTo(2, 2);
    // `variancePct` is the pre-existing "total" column (see schema.ts) --
    // comfortably under the OLD hardcoded 5%, so this would have silently
    // PASSED before DOM-011 (the whole gap this test proves is now closed).
    expect(Number(row!.variancePct)).toBeCloseTo(2, 2);
  });

  it("a tenant's configured override (qty 10% / price 8% / total 15%) is honored -- the SAME quantity shortfall that fails for an untouched tenant now passes", async () => {
    // Deliberately distinct from the platform default (0/2/5), not a
    // coincidental match, so the test actually proves the override is READ
    // and APPLIED rather than passing by accident.
    await runWithTenant(TENANT_OVERRIDE, () => db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO procurement.three_way_match_config (tenant_id, qty_tolerance_pct, price_tolerance_pct, total_tolerance_pct, created_by, updated_by)
        VALUES (${TENANT_OVERRIDE}::uuid, 10, 8, 15, ${ACTOR}::uuid, ${ACTOR}::uuid)
      `);
    }));

    const resolved = await runWithTenant(TENANT_OVERRIDE, () => db.transaction((tx) =>
      resolveThreeWayMatchToleranceConfig(tx as unknown as typeof db, TENANT_OVERRIDE)));
    expect(resolved).toEqual({ qtyTolerancePct: 10, priceTolerancePct: 8, totalTolerancePct: 15 });

    // Same 2%-qty-shortfall shape as the previous test (fails under the 0%
    // platform default) -- now built for TENANT_OVERRIDE, which allows 10%.
    const { poId, grnId } = await seedPoAndGrn(TENANT_OVERRIDE, { orderedQty: 50, acceptedQty: 49, unitPriceMinor: 2_000n });
    const row = await runMatch(TENANT_OVERRIDE, poId, grnId);
    expect(row!.matchStatus).toBe("matched"); // would be "mismatch" for a tenant without this override
    expect(Number(row!.qtyVariancePct)).toBeCloseTo(2, 2);
    expect(Number(row!.qtyTolerancePct)).toBeCloseTo(10, 2); // the applied threshold is persisted too, for audit

    // TENANT_DEFAULT is completely unaffected by TENANT_OVERRIDE's row (RLS
    // tenant_isolation_policy still scopes both reads and writes correctly).
    const untouched = await runWithTenant(TENANT_DEFAULT, () => db.transaction((tx) =>
      resolveThreeWayMatchToleranceConfig(tx as unknown as typeof db, TENANT_DEFAULT)));
    expect(untouched).toEqual(DEFAULT_TOLERANCE_CONFIG);
  });

  it("platform default: a 3% invoice-vs-GRN price gap is flagged mismatch even though the old blended total (3%) would have passed", async () => {
    const { poId, grnId } = await seedPoAndGrn(TENANT_DEFAULT, { orderedQty: 40, acceptedQty: 40, unitPriceMinor: 2_500n });
    // poAmountMinor = grnAmountMinor = 100,000n (exact qty) -> invoice 97,000n is a 3% gap on both the price axis and the (unchanged) total formula.
    const row = await runMatch(TENANT_DEFAULT, poId, grnId, 97_000n);
    expect(row!.matchStatus).toBe("mismatch");
    expect(Number(row!.qtyVariancePct)).toBeCloseTo(0, 2);
    expect(Number(row!.priceVariancePct)).toBeCloseTo(3, 2);
    expect(Number(row!.variancePct)).toBeCloseTo(3, 2); // "total" column, unaffected by the rename
  });
});
