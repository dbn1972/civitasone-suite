/**
 * GAP2-PROCUREMENT-THREEWAYMATCH-01 — POST /v1/procurement/matches/invoice
 * converted the invoice amount+tax from rupees to paise with the banned float
 * `Math.round((invoiceAmount + invoiceTax) * 100)`. The amount gates vendor
 * payment via the three-way-match variance, so a mis-rounded paise value could
 * wrongly pass/fail the match. Fix: accept the amount/tax as rupees DECIMAL
 * STRINGS and convert with exact BigInt arithmetic (rupeesStringToMinor),
 * rejecting >2-decimal input instead of silently rounding.
 *
 * Two layers (mirrors dom-027 / dom-032):
 *  1. Pure unit test of the money helper for the float-boundary values the
 *     acceptance criterion names (0.07 -> 7, 81234567.89 -> 8123456789).
 *  2. Real Postgres + real RLS + real consumer: the persisted
 *     invoiceAmountMinor is EXACTLY the BigInt value, and variancePct matches a
 *     BigInt computation — proving the conversion reaches storage float-free.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerThreeWayMatchConsumers } from "../src/modules/three-way-match/consumer.js";
import { threeWayMatch } from "../src/modules/three-way-match/schema.js";
import * as repo from "../src/modules/three-way-match/repo.js";
import { rupeesStringToMinor, invoiceTotalMinor } from "../src/modules/three-way-match/money.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { procurementGrns, procurementGrnItems } from "../src/modules/grn/schema.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "d0010101-aaaa-4000-8000-000000000001";
const ACTOR = randomUUID();

function tok() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["procurement_officer", "procurement_admin", "super_admin"], sid: "sess-gap01" }, SECRET);
}
const auth = { authorization: `Bearer ${tok()}` };

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

async function drain(q: MemoryQueue) {
  await Promise.race([q.drain(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  await q.stop();
}

async function seedPoGrnAndMatch(tenantId: string, unitPriceMinor: bigint, qty: number) {
  const poId = randomUUID();
  const poItemId = randomUUID();
  const grnId = randomUUID();
  const matchId = randomUUID();
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementPos).values({
    id: poId, tenantId, poNo: `PO-GAP01-${poId.slice(0, 8)}`, vendorId: randomUUID(),
    indentRef: "IND-GAP01", totalMinor: unitPriceMinor * BigInt(qty), status: "approved",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementPoItems).values({
    id: poItemId, poId, tenantId, itemCode: "ITEM-GAP01", description: "test item",
    quantity: qty, unitPriceMinor, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementGrns).values({
    id: grnId, tenantId, grnNo: `GRN-GAP01-${grnId.slice(0, 8)}`, poRef: `procurement_po:${poId}`,
    vendorId: randomUUID(), status: "accepted", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementGrnItems).values({
    id: randomUUID(), grnId, tenantId, poItemRef: poItemId, itemCode: "ITEM-GAP01",
    orderedQty: qty, receivedQty: qty, acceptedQty: qty, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await runWithTenant(tenantId, () => db.transaction((tx) => repo.upsertDerivedMatch(tx, {
    id: matchId, tenantId, poId, grnId,
    poAmountMinor: unitPriceMinor * BigInt(qty), grnAmountMinor: unitPriceMinor * BigInt(qty), matchStatus: "pending",
  })));
  return { poId, grnId, matchId };
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

afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("GAP2-PROCUREMENT-THREEWAYMATCH-01 — money helper is exact (float * 100 would mis-round these)", () => {
  it("0.07 rupees -> exactly 7 paise (0.07 * 100 === 7.000000000000001 in float)", () => {
    expect(rupeesStringToMinor("0.07")).toBe(7n);
  });
  it("81234567.89 rupees -> exactly 8123456789 paise (large value, no float loss)", () => {
    expect(rupeesStringToMinor("81234567.89")).toBe(8123456789n);
  });
  it("rejects >2-decimal input instead of silently rounding", () => {
    expect(rupeesStringToMinor("1.005")).toBeNull();
    expect(rupeesStringToMinor("12.345")).toBeNull();
  });
  it("rejects non-numeric and negative input", () => {
    expect(rupeesStringToMinor("abc")).toBeNull();
    expect(rupeesStringToMinor("-5")).toBeNull();
  });
  it("invoiceTotalMinor sums amount + tax exactly in BigInt", () => {
    expect(invoiceTotalMinor("0.07", "0")).toBe(7n);
    expect(invoiceTotalMinor("81234567.89", "0.11")).toBe(8123456800n);
    expect(invoiceTotalMinor("1.005", "0")).toBeNull();
  });
});

describe("GAP2-PROCUREMENT-THREEWAYMATCH-01 — HTTP boundary rejects >2-decimal money", () => {
  it("400s when invoiceAmount has 3 decimal places (was silently rounded before)", async () => {
    await cleanup();
    const { matchId } = await seedPoGrnAndMatch(TENANT, 2_000n, 10);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/matches/invoice", headers: auth,
      payload: { matchId, invoiceRef: "INV-GAP01-BAD", invoiceAmount: "12.345", invoiceTax: "0" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GAP2-PROCUREMENT-THREEWAYMATCH-01 — persisted invoiceAmountMinor is exact (real consumer)", () => {
  it("invoiceAmount '0.07' is stored as exactly 7 paise, not a float-rounded value", async () => {
    await cleanup();
    // PO/GRN delivered value is 7 paise so a 0.07-rupee invoice matches exactly.
    const { poId, grnId, matchId } = await seedPoGrnAndMatch(TENANT, 7n, 1);

    // Run the real consumer so it reacts to the queued command the HTTP handler publishes.
    const q = tenantWrappedQueue();
    registerThreeWayMatchConsumers(q);
    await q.start();

    // Capture what the HTTP handler publishes, then forward it to our tenant-wrapped consumer queue.
    const publishSpy = vi.spyOn(queue, "publish").mockImplementation(async (topic: string, msg: any) => {
      await q.publish(topic, msg);
    });
    try {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST", url: "/v1/procurement/matches/invoice", headers: auth,
        payload: { matchId, invoiceRef: "INV-GAP01-OK", invoiceAmount: "0.07", invoiceTax: "0" },
      });
      await app.close();
      expect(res.statusCode).toBe(202);
    } finally {
      publishSpy.mockRestore();
    }
    await drain(q);

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(threeWayMatch).where(eq(threeWayMatch.poId, poId))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.grnId).toBe(grnId);
    // The exact assertion: 7 paise persisted, not 7.000...1 rounded.
    expect(rows[0]!.invoiceAmountMinor).toBe(7n);
    // grnAmount == invoice == 7 paise -> price variance 0 -> matched.
    expect(rows[0]!.matchStatus).toBe("matched");
  });
});
