/**
 * MSME Wave-3 integration SEAM test (real Postgres, real consumers, no mocks).
 *
 * Proves the post -> ledger -> statement path across M2 (sales/AR), M3a (AP input tax + RCM + GST producer) and M8 (entity-type
 * statements) on a FULLY SEEDED commercial chart (seedGlHeadsTx "commercial"): a commercial invoice and AP bills must not make the
 * statements 409 STATEMENT_CLASS_MISSING, each balance lands in the right Schedule III / ITR group, the Balance Sheet balances, and
 * the M3a gst-ledger <-> gl reconciliation still holds.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { purgeLedgerRows } from "./_purge-ledger.js";
import { bearer } from "./_fp02.js";
import { buildApp } from "../src/app.js";
import { financeVendors } from "../src/modules/masters/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { seedGlHeadsTx } from "../src/modules/gl/standard-heads.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { registerGstConsumers } from "../src/modules/gst/consumer.js";
import { fyFromDate } from "../src/modules/hoa/voucher.js";
import { COMMANDS } from "../src/topics.js";
import { createCustomerTx, createDraftInvoiceTx, issueInvoiceTx } from "../src/modules/sales/service.js";

const ACTOR = randomUUID();
const APPROVERS = [randomUUID(), randomUUID()];
const TODAY = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const FY = fyFromDate(TODAY);
const GSTIN = "29ABCDE1234F1Z5"; // Karnataka
const SUPPLIER = "29AABCT1332L1ZT";
const rowsOf = (r: unknown): Array<Record<string, any>> => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, any>>;
const meta = (t: string) => ({ tenantId: t, actorId: ACTOR, correlationId: "corr-seam" });

interface Fx { tenantId: string; vendorId: string; entityType: string }
const mk = (entityType: string): Fx => ({ tenantId: randomUUID(), vendorId: randomUUID(), entityType });
const COMPANY = mk("company"), PROP = mk("proprietorship");
let prevFlag: string | undefined; let prevRcm: string | undefined;

async function seed(t: Fx): Promise<void> {
  await scoped(t.tenantId, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_settings (tenant_id, coa_template, accounting_basis, budget_control, gst_registered, gstin, gst_effective_from, entity_type, updated_by)
    VALUES (${t.tenantId}::uuid, 'commercial', 'accrual', 'off', true, ${GSTIN}, '2026-04-01', ${t.entityType}, ${ACTOR}::uuid)`));
  await scoped(t.tenantId, (tx) => seedGlHeadsTx(tx, t.tenantId, "commercial"));
  const h = await scoped(t.tenantId, (tx) => tx.select({ id: financeHeads.id }).from(financeHeads).where(sql`${financeHeads.tenantId} = ${t.tenantId}::uuid AND ${financeHeads.code} = '5400'`));
  await scoped(t.tenantId, (tx) => tx.insert(financeVendors).values({
    id: t.vendorId, tenantId: t.tenantId, name: "Vendor", category: "supplier", pan: "BBBBB1234F", address: "1 Road",
    bankName: "Bank", bankAccountNo: "000111222333", ifsc: "TEST0001234", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await scoped(t.tenantId, (tx) => tx.insert(financeBudgetAllocation).values({
    id: randomUUID(), tenantId: t.tenantId, headId: h[0]!.id, fy: FY, allocatedMinor: 100000000000n, committedMinor: 0n, actualMinor: 0n, createdBy: ACTOR, updatedBy: ACTOR,
  }));
}

function tenantQueue(): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (m: any) => Promise<void>) => raw(topic, (m: any) => runWithTenant(m.tenantId, () => handler(m)));
  registerPaymentsConsumers(q); registerGlConsumers(q); registerGstConsumers(q);
  return q;
}
async function pump(q: MemoryQueue, tenantId: string): Promise<void> {
  const topics = new Set([COMMANDS.journalPost, "finance.gst.entry_record", "finance.gst.rcm_itc_claim"]);
  for (let i = 0; i < 8; i++) {
    const rows = rowsOf(await scoped(tenantId, (tx) => tx.execute(sql`
      SELECT id, topic, actor_id, correlation_id, payload FROM _outbox.messages
       WHERE tenant_id = ${tenantId}::uuid AND published_at IS NULL ORDER BY created_at`))).filter((r) => topics.has(r.topic));
    if (rows.length === 0) return;
    for (const r of rows) {
      await scoped(tenantId, (tx) => tx.execute(sql`UPDATE _outbox.messages SET published_at = now() WHERE id = ${r.id}::uuid`));
      await q.publish(r.topic, { messageId: r.id, type: r.topic, tenantId, actorId: r.actor_id, correlationId: r.correlation_id, schemaVersion: "1.0", payload: r.payload });
    }
    await q.drain();
  }
}
async function bill(t: Fx, q: MemoryQueue, no: string, over: Record<string, unknown>): Promise<void> {
  const billId = randomUUID();
  await q.publish(COMMANDS.billCreate, {
    messageId: randomUUID(), type: COMMANDS.billCreate, tenantId: t.tenantId, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id: billId, tenantId: t.tenantId, billNo: no, vendorId: t.vendorId, headCode: "5400", grossMinor: "118000", netMinor: "118000", currency: "INR", deductions: [], poRef: "po:1", grnRef: "grn:1", billDate: TODAY, ...over },
  });
  await q.drain();
  for (const [i, stage] of (["section", "accounts"] as const).entries()) {
    await q.publish(COMMANDS.billApprove, {
      messageId: randomUUID(), type: COMMANDS.billApprove, tenantId: t.tenantId, actorId: APPROVERS[i]!, correlationId: randomUUID(), schemaVersion: "1.1",
      payload: { id: billId, tenantId: t.tenantId, expectedStage: stage },
    });
    await q.drain();
  }
  await pump(q, t.tenantId);
}
const dlq = (q: MemoryQueue): string => q.dlq.map((d) => String(d.error)).join(" | ");
async function balances(tenantId: string): Promise<Record<string, bigint>> {
  const r = rowsOf(await scoped(tenantId, (tx) => tx.execute(sql`
    SELECT h.code, COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::text AS bal
      FROM gl.finance_ledger l JOIN budget.finance_heads h ON h.id = l.head_id WHERE l.tenant_id = ${tenantId}::uuid GROUP BY h.code`)));
  return Object.fromEntries(r.map((x) => [x.code, BigInt(x.bal)]));
}
async function reconcile(tenantId: string): Promise<number> {
  const bal = await balances(tenantId);
  const sums = rowsOf(await scoped(tenantId, (tx) => tx.execute(sql`
    SELECT gl_head_code AS code, SUM(CASE WHEN direction = 'input' THEN tax_minor ELSE -tax_minor END)::text AS s
      FROM gl.finance_gst_ledger WHERE tenant_id = ${tenantId}::uuid AND gl_head_code IS NOT NULL AND status = 'active' GROUP BY gl_head_code`)));
  expect(sums.length).toBeGreaterThan(0);
  for (const s of sums) expect(BigInt(s.s), `head ${s.code}`).toBe(bal[s.code] ?? 0n);
  return sums.length;
}

/** Sales invoice (M2) + intra-state AP bill + RCM AP bill (M3a), all through the real consumers. */
async function postBooks(t: Fx): Promise<void> {
  const c = await scoped(t.tenantId, (tx) => createCustomerTx(tx, meta(t.tenantId), { customerCode: "SEAM-1", name: "Seam Customer", gstin: "29AAAAA0000A1Z5" }));
  const inv = await scoped(t.tenantId, async (tx) => issueInvoiceTx(tx, meta(t.tenantId), (await createDraftInvoiceTx(tx, meta(t.tenantId), {
    customerId: c.id, invoiceDate: TODAY, lines: [{ description: "Goods", hsnSac: "4820", qty: 2, rateMinor: 50000n }] })).id));
  expect(inv).toBeTruthy();
  const q = tenantQueue(); await q.start();
  await pump(q, t.tenantId); // the M2 invoice journal
  await bill(t, q, "SEAM-AP1", { vendorBillNo: "INV-77", gst: { supplierGstin: SUPPLIER, rcm: false, lines: [
    { gstType: "CGST", ratePct: 9, taxableMinor: "100000", taxMinor: "9000" }, { gstType: "SGST", ratePct: 9, taxableMinor: "100000", taxMinor: "9000" }] } });
  await bill(t, q, "SEAM-AP2", { grossMinor: "100000", netMinor: "100000", gst: { rcm: true, rcmCategory: "goods_transport", lines: [{ gstType: "IGST", ratePct: 5, taxableMinor: "100000", taxMinor: "5000" }] } });
  expect(dlq(q)).toBe("");
}

const B = "/v1/finance/statements/commercial";
const get = async (app: Awaited<ReturnType<typeof buildApp>>, t: string, url: string) => {
  const res = await app.inject({ method: "GET", url, headers: bearer(t, ACTOR, ["finance_officer"]) });
  return { status: res.statusCode, body: res.json() as Record<string, any> };
};
const codesIn = (groups: Array<{ key: string; lines: Array<{ code: string | null; amountMinor: string }> }>, key: string): Record<string, string> =>
  Object.fromEntries((groups.find((g) => g.key === key)?.lines ?? []).map((l) => [String(l.code), l.amountMinor]));

beforeAll(async () => {
  prevFlag = process.env.TENANT_PROFILES_ENABLED; prevRcm = process.env.FINANCE_GST_RCM_CATEGORIES;
  process.env.TENANT_PROFILES_ENABLED = "true"; process.env.FINANCE_GST_RCM_CATEGORIES = "goods_transport";
  for (const t of [COMPANY, PROP]) { await seed(t); await postBooks(t); }
}, 120_000);
afterAll(async () => {
  const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore("TENANT_PROFILES_ENABLED", prevFlag); restore("FINANCE_GST_RCM_CATEGORIES", prevRcm);
  for (const t of [COMPANY, PROP]) {
    await scoped(t.tenantId, (tx) => tx.execute(sql`DELETE FROM gl.finance_gst_ledger WHERE tenant_id = ${t.tenantId}::uuid`)).catch(() => undefined);
    await purgeLedgerRows(t.tenantId, sql`true`).catch(() => undefined);
  }
  await sqlClient.end();
});

describe("seam: ledger after M2 + M3a posting", () => {
  it.each([COMPANY, PROP])("$entityType: AR 1300, revenue 4001, ITC 1702/1703/1705, AP 2050, RCM payable 2301 hold the exact amounts", async (t) => {
    const b = await balances(t.tenantId);
    expect(b["1300"]).toBe(100000n); expect(b["4001"]).toBe(-100000n);
    expect(b["5400"]).toBe(200000n);
    expect(b["1702"]).toBe(9000n); expect(b["1703"]).toBe(9000n); expect(b["1705"]).toBe(5000n);
    expect(b["2050"]).toBe(-218000n); expect(b["2301"]).toBe(-5000n);
    expect(await reconcile(t.tenantId)).toBeGreaterThanOrEqual(3);
  });
  it("every head that carries a balance has a stored statement_class on the seeded chart", async () => {
    const r = rowsOf(await scoped(COMPANY.tenantId, (tx) => tx.execute(sql`
      SELECT h.code, h.classification, h.statement_class FROM budget.finance_heads h
       WHERE h.tenant_id = ${COMPANY.tenantId}::uuid AND h.statement_class IS NULL`)));
    expect(r).toEqual([]);
  });
});

describe("company -> Schedule III over the posted books (no 409)", () => {
  it("P&L, Balance Sheet and Cash Flow render; each balance sits in the right group; the Balance Sheet balances", async () => {
    const app = await buildApp();
    try {
      const all = await get(app, COMPANY.tenantId, `${B}/set?fy=${FY}`);
      expect(all.status, JSON.stringify(all.body)).toBe(200);
      expect(all.body.family).toBe("schedule_iii");
      const pl = all.body.profitAndLoss;
      expect(codesIn(pl.groups, "revenue_from_operations")["4001"]).toBe("100000");
      expect(pl.totalRevenueMinor).toBe("100000"); expect(pl.totalExpensesMinor).toBe("200000"); expect(pl.profitAfterTaxMinor).toBe("-100000");
      const bs = all.body.balanceSheet;
      expect(bs.balanced).toBe(true);
      expect(bs.totalAssetsMinor).toBe("123000"); expect(bs.totalEquityAndLiabilitiesMinor).toBe("123000");
      const assetCodes = bs.assets.flatMap((g: any) => g.lines.map((l: any) => l.code));
      for (const c of ["1300", "1702", "1703", "1705"]) expect(assetCodes, c).toContain(c);
      const cl = codesIn(bs.equityAndLiabilities, "current_liabilities");
      expect(cl["2050"]).toBe("218000"); expect(cl["2301"]).toBe("5000");
      expect(all.body.cashFlow.reconciles).toBe(true);
      for (const p of ["profit-and-loss", "balance-sheet", "cash-flow"]) expect((await get(app, COMPANY.tenantId, `${B}/${p}?fy=${FY}`)).status, p).toBe(200);
    } finally { await app.close(); }
  });
});

describe("proprietorship -> Trading + P&L + Balance Sheet over the posted books (no 409)", () => {
  it("renders, balances, and no cash flow", async () => {
    const app = await buildApp();
    try {
      const all = await get(app, PROP.tenantId, `${B}/set?fy=${FY}`);
      expect(all.status, JSON.stringify(all.body)).toBe(200);
      expect(all.body.family).toBe("trading_pl_bs");
      expect(all.body.tradingAccount.salesMinor).toBe("100000");
      expect(all.body.tradingAccount.grossProfitMinor).toBe("-100000");
      expect(all.body.profitAndLoss.netProfitMinor).toBe("-100000");
      expect(all.body.balanceSheet.balanced).toBe(true);
      expect(all.body.balanceSheet.totalAssetsMinor).toBe("123000");
      expect((await get(app, PROP.tenantId, `${B}/trading-account?fy=${FY}`)).status).toBe(200);
      expect((await get(app, PROP.tenantId, `${B}/cash-flow?fy=${FY}`)).status).toBe(404);
    } finally { await app.close(); }
  });
});
