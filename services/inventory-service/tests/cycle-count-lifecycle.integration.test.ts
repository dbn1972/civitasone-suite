/**
 * cycle-count FULL LIFECYCLE — end-to-end regression coverage for the three
 * stacked bugs that made this module's stock-take/reconciliation capability
 * completely non-functional (plus a fourth found while fixing them):
 *
 *   #1 migrations/0011's cycle_counts_status_chk CHECK constraint allowed
 *      only ('pending','approved','rejected','auto_adjusted'), but
 *      domain.ts's evaluateCycleCount() can only ever produce 'auto_posted'
 *      or 'pending_approval' -- every create failed on a real Postgres
 *      CHECK-constraint violation. Fixed by
 *      migrations/0022_cycle_counts_status_chk_fix.sql.
 *   #2 consumer.ts hardcoded `const systemQty = 0` instead of querying the
 *      real stock balance -- every count showed a 100% variance regardless
 *      of reality. Fixed via movements/repo.ts's lockBalance (see
 *      cycle-count/consumer.ts).
 *   #3 neither the auto-post nor the approve path ever wrote to
 *      stock_balances/stock_ledger -- a "completed" stock-take never actually
 *      corrected the system's recorded stock. Fixed via
 *      cycle-count/consumer.ts's postReconciliation(), mirroring
 *      movements/consumer.ts's own adjustmentCreate handler.
 *   #4 (found while fixing #2/#3, not in the original bug list) commands.ts
 *      reused the cycle count's own id as BOTH the entity id and the
 *      transport-level messageId for approve/reject -- identical to the
 *      value create's message already used, so `_inbox.processed`
 *      (global, id-only PK) treated every approve/reject as an
 *      already-processed duplicate and silently no-opped. Fixed in
 *      commands.ts's publish() call sites (fresh randomUUID messageId per
 *      command). Test B below (approve) and the reject test would both have
 *      silently failed to change status before this fix.
 *
 * Each test hand-computes the expected variance/threshold and asserts the
 * system's stock_balances/stock_ledger are ACTUALLY corrected to match the
 * physical count -- not just that the cycle_counts row itself looks right.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { eq, and } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { registerCycleCountConsumers } from "../src/modules/cycle-count/consumer.js";
import { registerItemConsumers } from "../src/modules/items/consumer.js";
import { registerStoreConsumers } from "../src/modules/stores/consumer.js";
import { registerMovementConsumers } from "../src/modules/movements/consumer.js";
import { movements } from "../src/modules/movements/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ROLE = "inventory_manager"; // covers item/store/receipt create AND cycle-count create+approve+reject

function authHeaders(tid: string): Record<string, string> {
  const jwt = signToken({ sub: randomUUID(), tid, roles: [ROLE], sid: "sess-cycle-count-lifecycle" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}

registerCycleCountConsumers(appQueue);
registerItemConsumers(appQueue);
registerStoreConsumers(appQueue);
registerMovementConsumers(appQueue);
await appQueue.start();

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

/** Seeds a fresh tenant + real item + real store, and receipts `qty` units at `rateMinor` into it. Returns everything a test needs. */
async function seedTenantWithStock(qty: number, rateMinor: number) {
  const tid = randomUUID();
  const h = authHeaders(tid);

  const itemRes = await app.inject({ method: "POST", url: "/v1/inventory/items", headers: h, payload: { name: "Lifecycle Item" } });
  expect(itemRes.statusCode).toBe(202);
  const { id: itemId } = itemRes.json();

  const storeRes = await app.inject({ method: "POST", url: "/v1/inventory/stores", headers: h, payload: { name: "Lifecycle Store", code: `LC-${randomUUID().slice(0, 8)}` } });
  expect(storeRes.statusCode).toBe(202);
  const { id: storeId } = storeRes.json();
  await appQueue.drain();

  const receiptRes = await app.inject({
    method: "POST", url: "/v1/inventory/receipts", headers: h,
    payload: { toStoreId: storeId, postingDate: "2026-01-01", lines: [{ itemId, qty, rateMinor, currency: "INR" }] },
  });
  expect(receiptRes.statusCode).toBe(202);
  await appQueue.drain();

  return { tid, h, itemId, storeId };
}

async function getBalance(h: Record<string, string>, itemId: string, storeId: string) {
  const res = await app.inject({ method: "GET", url: `/v1/inventory/balances?itemId=${itemId}&storeId=${storeId}`, headers: h });
  expect(res.statusCode).toBe(200);
  return res.json().data[0] as { onHandQty: number; avgRateMinor: string } | undefined;
}

async function getLedger(h: Record<string, string>, itemId: string, storeId: string) {
  const res = await app.inject({ method: "GET", url: `/v1/inventory/ledger?itemId=${itemId}&storeId=${storeId}`, headers: h });
  expect(res.statusCode).toBe(200);
  return res.json().data as Array<{ qtyIn: number; qtyOut: number; balanceQty: number; movementType: string; movementId: string }>;
}

describe("cycle-count full lifecycle — auto-posted variance (within threshold)", () => {
  it("computes the variance correctly and reconciles stock_balances/stock_ledger to the physical count", async () => {
    // System has 250 @ 150.00; physical count finds 258 -> +8 surplus.
    // threshold = max(ceil(5% of 250)=13, 10) = 13; |8| <= 13 -> auto_posted.
    const { tid, h, itemId, storeId } = await seedTenantWithStock(250, 15000);

    const before = await getBalance(h, itemId, storeId);
    expect(before?.onHandQty).toBe(250); // sanity: real stock genuinely seeded

    const ccRes = await app.inject({
      method: "POST", url: "/v1/inventory/cycle-counts", headers: h,
      payload: { itemId, warehouseId: storeId, physicalQty: 258, reasonCode: "cycle_count" },
    });
    expect(ccRes.statusCode).toBe(202);
    const { id: ccId } = ccRes.json();
    await appQueue.drain();

    const rec = (await app.inject({ method: "GET", url: `/v1/inventory/cycle-counts/${ccId}`, headers: h })).json().data;
    expect(rec.systemQty).toBe(250); // NOT hardcoded 0 (bug #2)
    expect(rec.variance).toBe(8);
    expect(rec.absVariance).toBe(8);
    expect(rec.autoAdjustThreshold).toBe(13);
    expect(rec.status).toBe("auto_posted");
    expect(rec.adjustmentId).not.toBeNull();

    const after = await getBalance(h, itemId, storeId);
    expect(after?.onHandQty).toBe(258); // stock ACTUALLY corrected (bug #3)
    expect(after?.avgRateMinor).toBe("15000"); // rate carried forward unchanged

    const ledger = await getLedger(h, itemId, storeId);
    expect(ledger.length).toBe(2); // original receipt + this reconciliation
    const adj = ledger.find((l) => l.movementType === "adjustment")!;
    expect(adj).toBeDefined();
    expect(adj.qtyIn).toBe(8);
    expect(adj.qtyOut).toBe(0);
    expect(adj.balanceQty).toBe(258);

    // Belt-and-suspenders: the movements header itself exists, tied back to
    // this cycle count (ref_doc/ref_no), not just the ledger row.
    const mv = await runWithTenant(tid, () =>
      db.transaction((tx) => tx.select().from(movements)
        .where(and(eq(movements.id, adj.movementId), eq(movements.tenantId, tid)))),
    );
    expect(mv[0]?.movementType).toBe("adjustment");
    expect(mv[0]?.refDoc).toBe("CYCLE_COUNT");
    expect(mv[0]?.refNo).toBe(ccId);
    expect(mv[0]?.toStoreId).toBe(storeId);
  });
});

describe("cycle-count full lifecycle — variance above threshold requires approval", () => {
  it("does not touch stock until approved, then reconciles correctly (also regression-covers bug #4's messageId fix)", async () => {
    // System has 250; physical count finds 400 -> +150 surplus, exceeds the 13-unit threshold.
    const { h, itemId, storeId } = await seedTenantWithStock(250, 15000);

    const ccRes = await app.inject({
      method: "POST", url: "/v1/inventory/cycle-counts", headers: h,
      payload: { itemId, warehouseId: storeId, physicalQty: 400, reasonCode: "recount" },
    });
    expect(ccRes.statusCode).toBe(202);
    const { id: ccId } = ccRes.json();
    await appQueue.drain();

    let rec = (await app.inject({ method: "GET", url: `/v1/inventory/cycle-counts/${ccId}`, headers: h })).json().data;
    expect(rec.variance).toBe(150);
    expect(rec.absVariance).toBe(150);
    expect(rec.autoAdjustThreshold).toBe(13);
    expect(rec.status).toBe("pending_approval");
    expect(rec.adjustmentId).toBeNull();

    // Not yet posted -- stock must be untouched while awaiting approval.
    const beforeApprove = await getBalance(h, itemId, storeId);
    expect(beforeApprove?.onHandQty).toBe(250);
    expect((await getLedger(h, itemId, storeId)).length).toBe(1); // just the receipt

    const approveRes = await app.inject({
      method: "POST", url: `/v1/inventory/cycle-counts/${ccId}/approve`, headers: h,
      payload: { version: rec.version },
    });
    expect(approveRes.statusCode).toBe(202);
    await appQueue.drain();

    rec = (await app.inject({ method: "GET", url: `/v1/inventory/cycle-counts/${ccId}`, headers: h })).json().data;
    // If bug #4 (messageId collision) were NOT fixed, this approve would have
    // silently no-op'd and status would incorrectly still read 'pending_approval'.
    expect(rec.status).toBe("approved");
    expect(rec.approvedBy).not.toBeNull();
    expect(rec.adjustmentId).not.toBeNull();

    const after = await getBalance(h, itemId, storeId);
    expect(after?.onHandQty).toBe(400); // NOW corrected, only after approval

    const ledger = await getLedger(h, itemId, storeId);
    expect(ledger.length).toBe(2);
    const adj = ledger.find((l) => l.movementType === "adjustment")!;
    expect(adj.qtyIn).toBe(150);
    expect(adj.balanceQty).toBe(400);
  });
});

describe("cycle-count full lifecycle — no-variance count", () => {
  it("still posts (records the count) but writes no ledger entry and leaves the balance untouched", async () => {
    const { h, itemId, storeId } = await seedTenantWithStock(100, 20000);

    const ccRes = await app.inject({
      method: "POST", url: "/v1/inventory/cycle-counts", headers: h,
      payload: { itemId, warehouseId: storeId, physicalQty: 100, reasonCode: "cycle_count" },
    });
    expect(ccRes.statusCode).toBe(202);
    const { id: ccId } = ccRes.json();
    await appQueue.drain();

    const rec = (await app.inject({ method: "GET", url: `/v1/inventory/cycle-counts/${ccId}`, headers: h })).json().data;
    expect(rec.systemQty).toBe(100);
    expect(rec.variance).toBe(0);
    expect(rec.absVariance).toBe(0);
    expect(rec.status).toBe("auto_posted"); // yes, it still posts -- the count happened, it just changed nothing
    expect(rec.adjustmentId).not.toBeNull(); // a movement IS recorded, for the audit trail

    const after = await getBalance(h, itemId, storeId);
    expect(after?.onHandQty).toBe(100); // unchanged
    expect(after?.avgRateMinor).toBe("20000");

    // No ledger row for a zero-diff adjustment -- same convention movements/
    // consumer.ts's own adjustmentCreate uses.
    const ledger = await getLedger(h, itemId, storeId);
    expect(ledger.length).toBe(1); // just the original receipt
    expect(ledger.some((l) => l.movementType === "adjustment")).toBe(false);
  });
});

describe("cycle-count full lifecycle — rejection", () => {
  it("rejecting a pending-approval count leaves stock untouched (also regression-covers bug #4 for the reject command)", async () => {
    const { h, itemId, storeId } = await seedTenantWithStock(250, 15000);

    const ccRes = await app.inject({
      method: "POST", url: "/v1/inventory/cycle-counts", headers: h,
      payload: { itemId, warehouseId: storeId, physicalQty: 400, reasonCode: "recount" },
    });
    const { id: ccId } = ccRes.json();
    await appQueue.drain();

    let rec = (await app.inject({ method: "GET", url: `/v1/inventory/cycle-counts/${ccId}`, headers: h })).json().data;
    expect(rec.status).toBe("pending_approval");

    const rejectRes = await app.inject({
      method: "POST", url: `/v1/inventory/cycle-counts/${ccId}/reject`, headers: h,
      payload: { version: rec.version, reason: "recount looks wrong, redo the physical count" },
    });
    expect(rejectRes.statusCode).toBe(202);
    await appQueue.drain();

    rec = (await app.inject({ method: "GET", url: `/v1/inventory/cycle-counts/${ccId}`, headers: h })).json().data;
    expect(rec.status).toBe("rejected"); // would have stayed 'pending_approval' before bug #4's fix
    expect(rec.rejectedBy).not.toBeNull();
    expect(rec.adjustmentId).toBeNull();

    const after = await getBalance(h, itemId, storeId);
    expect(after?.onHandQty).toBe(250); // untouched — a rejected count never reconciles
  });
});
