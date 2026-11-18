/**
 * MSME v1 CAPSTONE end-to-end (real Postgres, migrations 0173..0184, real gl + gst consumers, NO seeded ledger rows).
 *
 * One commercial `company` tenant (gst_registered, full commercial chart) is driven through the whole chain:
 *   M2+M3b  sales invoices (multi-rate, intra/inter, B2B/B2CL/B2CS) + advance receipt + credit notes (in / out of the s.34 window)
 *           -> Dr AR 1300 / Cr 4001 / Cr 2300 AND OUTPUT gst-ledger rows (via the M3a producer)
 *   M3a     AP GST bill (CGST+SGST) + RCM bill (+ rcm-claim once paid) -> INPUT tax, per-tax ITC, INPUT gst-ledger rows
 *   M4      GSTR-1 + GSTR-3B prepared over the REAL ledger and invoices; GSTR-1 <-> 3B reconciliation; rate derivation vs M3b stored rate
 *   M8      Schedule III (P&L + Balance Sheet + Cash Flow), no 409
 *   M3a     gst-ledger <-> gl reconciliation, both directions
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
import { createCustomerTx, createDraftInvoiceTx, issueInvoiceTx, createNoteTx, issueNoteTx, createAdvanceReceiptTx } from "../src/modules/sales/service.js";

const ACTOR = randomUUID();
const APPROVERS = [randomUUID(), randomUUID()];
const T = randomUUID();
const VENDOR = randomUUID();
const GSTIN = "29ABCDE1234F1Z5"; // Karnataka
const SUPPLIER = "29AABCT1332L1ZT";
const PERIOD = "2026-11";
const FY = fyFromDate("2026-11-04");
const rowsOf = (r: unknown): Array<Record<string, any>> => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, any>>;
const meta = { tenantId: T, actorId: ACTOR, correlationId: "corr-v1-e2e" };
const q1 = async (query: ReturnType<typeof sql>) => rowsOf(await scoped(T, (tx) => tx.execute(query)));
const ids: Record<string, any> = {};
const report: Record<string, unknown> = {};
let prevFlag: string | undefined; let prevRcm: string | undefined;
let app: Awaited<ReturnType<typeof buildApp>>;
let billIdRcm = "";

function tenantQueue(): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (m: any) => Promise<void>) => raw(topic, (m: any) => runWithTenant(m.tenantId, () => handler(m)));
  registerPaymentsConsumers(q); registerGlConsumers(q); registerGstConsumers(q);
  return q;
}
async function pump(q: MemoryQueue): Promise<void> {
  const topics = new Set([COMMANDS.journalPost, "finance.gst.entry_record", "finance.gst.rcm_itc_claim"]);
  for (let i = 0; i < 8; i++) {
    const rows = rowsOf(await scoped(T, (tx) => tx.execute(sql`
      SELECT id, topic, actor_id, correlation_id, payload FROM _outbox.messages
       WHERE tenant_id = ${T}::uuid AND published_at IS NULL ORDER BY created_at`))).filter((r) => topics.has(r.topic));
    if (rows.length === 0) return;
    for (const r of rows) {
      await scoped(T, (tx) => tx.execute(sql`UPDATE _outbox.messages SET published_at = now() WHERE id = ${r.id}::uuid`));
      await q.publish(r.topic, { messageId: r.id, type: r.topic, tenantId: T, actorId: r.actor_id, correlationId: r.correlation_id, schemaVersion: "1.0", payload: r.payload });
    }
    await q.drain();
  }
}
async function bill(q: MemoryQueue, no: string, over: Record<string, unknown>): Promise<string> {
  const billId = randomUUID();
  await q.publish(COMMANDS.billCreate, {
    messageId: randomUUID(), type: COMMANDS.billCreate, tenantId: T, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id: billId, tenantId: T, billNo: no, vendorId: VENDOR, headCode: "5400", grossMinor: "118000", netMinor: "118000", currency: "INR", deductions: [], poRef: "po:1", grnRef: "grn:1", billDate: "2026-11-04", ...over },
  });
  await q.drain();
  for (const [i, stage] of (["section", "accounts"] as const).entries()) {
    await q.publish(COMMANDS.billApprove, {
      messageId: randomUUID(), type: COMMANDS.billApprove, tenantId: T, actorId: APPROVERS[i]!, correlationId: randomUUID(), schemaVersion: "1.1",
      payload: { id: billId, tenantId: T, expectedStage: stage },
    });
    await q.drain();
  }
  await pump(q);
  return billId;
}
const dlq = (q: MemoryQueue): string => q.dlq.map((d) => String(d.error)).join(" | ");
async function balances(): Promise<Record<string, bigint>> {
  const r = await q1(sql`SELECT h.code, COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::text AS bal
      FROM gl.finance_ledger l JOIN budget.finance_heads h ON h.id = l.head_id WHERE l.tenant_id = ${T}::uuid GROUP BY h.code`);
  return Object.fromEntries(r.map((x) => [x.code, BigInt(x.bal)]));
}
const call = async (method: "GET" | "POST", url: string, payload?: unknown, base = app) => {
  const res = await base.inject({ method, url, headers: bearer(T, ACTOR, ["finance_officer"]), ...(payload !== undefined ? { payload: payload as object } : {}) });
  let body: any = null; try { body = res.body ? res.json() : null; } catch { body = res.body; }
  return { status: res.statusCode, body };
};
/** every {rt, txval} item object anywhere under a node (GSTR-1 JSON is version-shaped; this is shape-agnostic). */
function items(node: any, out: Array<{ rt: number; txval: number }> = []): Array<{ rt: number; txval: number }> {
  if (Array.isArray(node)) node.forEach((n) => items(n, out));
  else if (node && typeof node === "object") { if (typeof node.rt === "number" && typeof node.txval === "number") out.push({ rt: node.rt, txval: node.txval }); Object.values(node).forEach((n) => items(n, out)); }
  return out;
}
const sumByRate = (xs: Array<{ rt: number; txval: number }>): Record<string, number> => {
  const o: Record<string, number> = {};
  for (const x of xs) o[String(x.rt)] = Math.round(((o[String(x.rt)] ?? 0) + x.txval) * 100) / 100;
  return o;
};

beforeAll(async () => {
  prevFlag = process.env.TENANT_PROFILES_ENABLED; prevRcm = process.env.FINANCE_GST_RCM_CATEGORIES;
  process.env.TENANT_PROFILES_ENABLED = "true"; process.env.FINANCE_GST_RCM_CATEGORIES = "goods_transport";
  await scoped(T, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_settings (tenant_id, coa_template, accounting_basis, budget_control, gst_registered, gstin, gst_effective_from, entity_type, updated_by)
    VALUES (${T}::uuid, 'commercial', 'accrual', 'off', true, ${GSTIN}, '2025-01-01', 'company', ${ACTOR}::uuid)`));
  await scoped(T, (tx) => seedGlHeadsTx(tx, T, "commercial"));
  const h = await scoped(T, (tx) => tx.select({ id: financeHeads.id }).from(financeHeads).where(sql`${financeHeads.tenantId} = ${T}::uuid AND ${financeHeads.code} = '5400'`));
  await scoped(T, (tx) => tx.insert(financeVendors).values({
    id: VENDOR, tenantId: T, name: "Vendor", category: "supplier", pan: "BBBBB1234F", address: "1 Road",
    bankName: "Bank", bankAccountNo: "000111222333", ifsc: "TEST0001234", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await scoped(T, (tx) => tx.insert(financeBudgetAllocation).values({
    id: randomUUID(), tenantId: T, headId: h[0]!.id, fy: FY, allocatedMinor: 100000000000n, committedMinor: 0n, actualMinor: 0n, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  app = await buildApp();

  // ---- M2 + M3b: customers, invoices, advance, credit notes ------------------------------------------------------------------
  const cust = async (code: string, o: Record<string, unknown>) => (await scoped(T, (tx) => createCustomerTx(tx, meta, { customerCode: code, name: `Customer ${code}`, ...o } as any))).id;
  const cKA = await cust("KA", { gstin: "29AAAAA0000A1Z5", pan: "AAAAA0000A" });
  const cMH = await cust("MH", { gstin: "27AAAAA0000A1Z5", pan: "AAAAA0000A" });
  const cDL = await cust("DL", { stateCode: "07" });
  const cKB = await cust("KB", { stateCode: "29" });
  const mk = async (customerId: string, date: string, lines: any[]) => {
    const d = await scoped(T, (tx) => createDraftInvoiceTx(tx, meta, { customerId, invoiceDate: date, lines } as any));
    return scoped(T, (tx) => issueInvoiceTx(tx, meta, d.id));
  };
  ids.old = await mk(cKA, "2025-03-10", [{ description: "Old stock", hsnSac: "4820", qty: 2, rateMinor: 100000n, gstRatePct: "18" }]);
  ids.i1 = await mk(cKA, "2026-11-03", [{ description: "Registers", hsnSac: "4820", qty: 10, rateMinor: 100000n, gstRatePct: "18" }, { description: "Books", hsnSac: "6109", qty: 2, rateMinor: 50000n, gstRatePct: "5" }]);
  ids.i2 = await mk(cMH, "2026-11-05", [{ description: "Registers", hsnSac: "4820", qty: 5, rateMinor: 100000n, gstRatePct: "18" }]);
  ids.i3 = await mk(cDL, "2026-11-07", [{ description: "Bulk", hsnSac: "4820", qty: 1, rateMinor: 20_000_000n, gstRatePct: "18" }]);
  ids.i4 = await mk(cDL, "2026-11-08", [{ description: "Small", hsnSac: "4820", qty: 1, rateMinor: 500_000n, gstRatePct: "18" }]);
  ids.i5 = await mk(cKB, "2026-11-09", [{ description: "Retail", hsnSac: "4820", qty: 1, rateMinor: 90_000n, gstRatePct: "18" }]);
  ids.adv = await scoped(T, (tx) => createAdvanceReceiptTx(tx, meta, { customerId: cMH, receiptDate: "2026-11-12", amountMinor: 118000n, gstRatePct: "18" } as any));
  const cn1 = await scoped(T, (tx) => createNoteTx(tx, meta, { invoiceId: ids.i1.id, noteType: "credit", noteDate: "2026-11-15", reason: "sales_return", taxableMinor: 100000n, gstRatePct: "18" } as any));
  ids.cn1 = await scoped(T, (tx) => issueNoteTx(tx, meta, cn1.id));
  const cn2 = await scoped(T, (tx) => createNoteTx(tx, meta, { invoiceId: ids.old.id, noteType: "credit", noteDate: "2026-11-16", reason: "sales_return", taxableMinor: 50000n, gstRatePct: "18" } as any));
  ids.cn2 = await scoped(T, (tx) => issueNoteTx(tx, meta, cn2.id));

  const q = tenantQueue(); await q.start();
  await pump(q); // sales + credit-note journals and their OUTPUT gst-ledger rows
  // ---- M3a: AP bills ---------------------------------------------------------------------------------------------------------
  await bill(q, "E2E-AP1", { vendorBillNo: "INV-77", gst: { supplierGstin: SUPPLIER, rcm: false, lines: [
    { gstType: "CGST", ratePct: 9, taxableMinor: "100000", taxMinor: "9000" }, { gstType: "SGST", ratePct: 9, taxableMinor: "100000", taxMinor: "9000" }] } });
  billIdRcm = await bill(q, "E2E-AP2", { grossMinor: "100000", netMinor: "100000", gst: { rcm: true, rcmCategory: "goods_transport", lines: [{ gstType: "IGST", ratePct: 5, taxableMinor: "100000", taxMinor: "5000" }] } });
  // RCM ITC is claimable only once the RCM tax is PAID
  // (the HTTP route /v1/finance/gst/rcm-claim only enqueues this command; the capstone delivers it to the real consumer directly)
  await q.publish("finance.gst.rcm_itc_claim", {
    messageId: randomUUID(), type: "finance.gst.rcm_itc_claim", tenantId: T, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id: randomUUID(), billId: billIdRcm, paidOn: "2026-11-18", challanRef: "CHALLAN-E2E-1" },
  });
  await q.drain();
  await pump(q);
  expect(dlq(q)).toBe("");
}, 240_000);

afterAll(async () => {
  const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore("TENANT_PROFILES_ENABLED", prevFlag); restore("FINANCE_GST_RCM_CATEGORIES", prevRcm);
  console.log("E2E-REPORT " + JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  await scoped(T, (tx) => tx.execute(sql`DELETE FROM gl.finance_gst_ledger WHERE tenant_id = ${T}::uuid`)).catch(() => undefined);
  await purgeLedgerRows(T, sql`true`).catch(() => undefined);
  await app?.close();
  await sqlClient.end();
});

describe("1. M2+M3b / M3a postings through the real consumers", () => {
  it("AR 1300 / revenue 4001 / output tax 2300 / bills / ITC hold the exact amounts", async () => {
    const b = await balances(); report.glBalances = b;
    expect(b["4001"]).toBe(-22_240_000n);          // taxable: 200k old + 22.19M Nov - CN1 100k - CN2 50k
    expect(b["2300"]).toBe(-3_990_200n);           // output tax: 36,000 + 3,981,200 - 18,000 - 9,000
    expect(b["1300"]).toBe(26_230_200n);           // AR = revenue + output tax
    expect(b["1300"]! + b["4001"]! + b["2300"]!).toBe(0n);
    expect(b["5400"]).toBe(200_000n); expect(b["2301"]).toBe(-5_000n);
  });
  it("AR sub-ledger vs GL control: only the unposted advance explains any gap", async () => {
    const r = await q1(sql`SELECT COALESCE(SUM(debit_minor - credit_minor),0)::text AS s FROM ar.ledger_entries WHERE tenant_id = ${T}::uuid`);
    const gl = (await balances())["1300"]!; report.arSubledger = r[0]!.s; report.glAr = gl;
    expect(BigInt(r[0]!.s)).toBe(gl);
  });
  it("gst-ledger carries OUTPUT rows (invoices + both credit notes) and INPUT rows (bills) from the real producer", async () => {
    const d = await q1(sql`SELECT direction, source_doc_type, count(*)::int AS n FROM gl.finance_gst_ledger WHERE tenant_id = ${T}::uuid AND status = 'active' GROUP BY 1,2 ORDER BY 1,2`);
    report.ledgerShape = d;
    const has = (dir: string, t: string) => d.some((x) => x.direction === dir && x.source_doc_type === t);
    expect(has("output", "sales_invoice")).toBe(true); expect(has("output", "credit_note")).toBe(true); expect(has("input", "bill")).toBe(true);
  });
  it("gst-ledger sum by head == gl head balance, BOTH directions", async () => {
    const bal = await balances();
    const sums = await q1(sql`SELECT gl_head_code AS code, direction, SUM(tax_minor)::text AS s FROM gl.finance_gst_ledger
      WHERE tenant_id = ${T}::uuid AND gl_head_code IS NOT NULL AND status = 'active' GROUP BY gl_head_code, direction`);
    const byHead = new Map<string, bigint>();
    for (const s of sums) byHead.set(s.code, (byHead.get(s.code) ?? 0n) + (s.direction === "input" ? BigInt(s.s) : -BigInt(s.s)));
    report.reconByHead = Object.fromEntries([...byHead].map(([k, v]) => [k, { ledger: v, gl: bal[k] ?? 0n }]));
    expect(sums.some((s) => s.direction === "output") && sums.some((s) => s.direction === "input")).toBe(true);
    for (const [code, v] of byHead) expect(v, `head ${code}`).toBe(bal[code] ?? 0n);
  });
});

describe("2. M4: GSTR-1 + GSTR-3B over the REAL ledger", () => {
  let run: any;
  beforeAll(async () => {
    const r = await call("POST", "/v1/finance/gst-returns/runs", { period: PERIOD });
    expect(r.status, JSON.stringify(r.body)).toBe(201); run = r.body.data; report.runWarnings = run.warnings;
  });
  it("GSTR-1 buckets come from the real invoices; the out-of-window credit note is EXCLUDED and flagged", () => {
    const g = run.gstr1; report.gstr1Counts = run.summary.counts;
    expect(g.b2b.map((c: any) => c.ctin).sort()).toEqual(["27AAAAA0000A1Z5", "29AAAAA0000A1Z5"]);
    expect(g.b2cl).toHaveLength(1); expect(g.b2cl[0].pos).toBe("07");
    expect(g.b2cs.map((r: any) => `${r.sply_ty}|${r.pos}|${r.rt}`).sort()).toEqual(["INTER|07|18", "INTRA|29|18"]);
    const nts = g.cdnr.flatMap((c: any) => c.nt);
    expect(nts).toHaveLength(1); expect(nts[0]).toMatchObject({ ntty: "C", nt_dt: "15-11-2026" });
    expect(nts[0].nt_num).toBe(ids.cn1.noteNo); expect(JSON.stringify(g.cdnr)).not.toContain(ids.cn2.noteNo);
    expect(run.warnings.join(" | ")).toMatch(/S34_OUT_OF_WINDOW/); expect(run.warnings.join(" | ")).toContain(ids.cn2.noteNo);
    expect(g.at.length).toBe(1); // the unadjusted advance from ar.advance_receipts
  });
  it("HSN summary == the real invoice lines", () => {
    const hsnTax = run.gstr1.hsn.data.reduce((a: number, h: any) => a + h.txval, 0);
    report.hsnTaxableRs = hsnTax; report.hsnRows = run.gstr1.hsn.data.map((h: any) => ({ hsn: h.hsn_sc, txval: h.txval, rt: h.rt }));
    expect(hsnTax).toBeCloseTo((1_000_000 + 100_000 + 500_000 + 20_000_000 + 500_000 + 90_000) / 100, 2);
  });
  it("GSTR-3B 3.1 == real OUTPUT ledger; 4 ITC == real INPUT ledger incl. RCM once paid", () => {
    const b = run.gstr3b; const s = run.summary.totals; report.gstr3bSummary = run.summary.gstr3b; report.taxedOutward = s.taxedOutward; report.gstr3b = b;
    expect(s.taxedOutward).toMatchObject({ igst: "3780000", cgst: "91600", sgst: "91600" });
    expect(b.sup_details.osup_det.txval).toBe(220_900);
    expect(b.sup_details.osup_det.iamt).toBe(37_800); expect(b.sup_details.osup_det.camt).toBe(916); expect(b.sup_details.osup_det.samt).toBe(916);
    expect(b.sup_details.isup_rev).toMatchObject({ txval: 1000, iamt: 50 });
    expect(b.itc_elg.itc_avl.find((x: any) => x.ty === "ISRC").iamt).toBe(50);
    expect(b.itc_elg.itc_avl.find((x: any) => x.ty === "OTH")).toMatchObject({ camt: 90, samt: 90 });
    expect(b.inter_sup.unreg_details).toEqual([{ pos: "07", txval: 205000, iamt: 36900 }]);
  });
  it("GSTR-1 <-> GSTR-3B reconciliation diff == 0 on the real data", () => {
    report.reconciliation = run.reconciliation;
    expect(run.reconciliation.ok, JSON.stringify(run.reconciliation)).toBe(true);
    expect(run.reconciliation.unmatchedDocs).toEqual([]);
    expect(run.reconciliation.checks.length).toBeGreaterThanOrEqual(6);
    for (const c of run.reconciliation.checks) expect([c.name, c.diffMinor, c.ok]).toEqual([c.name, "0", true]);
  });
  it("RATE AGREEMENT: M4's derived rate (tax/taxable) == M3b's stored rate on invoices, notes and gst-ledger rows", async () => {
    const g = run.gstr1;
    // invoices: GSTR-1 outward by rate vs ar.sales_invoice_lines stored rate (current-period issued invoices)
    const outward = sumByRate(items([g.b2b, g.b2cl, g.b2cs]));
    const dbLines = await q1(sql`SELECT l.gst_rate_pct::numeric::text AS rt, SUM(l.taxable_minor)::text AS tx FROM ar.sales_invoice_lines l
      JOIN ar.sales_invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id WHERE l.tenant_id = ${T}::uuid AND i.status = 'issued' AND i.invoice_date >= '2026-11-01' AND i.invoice_date <= '2026-11-30' GROUP BY 1`);
    const dbOut = Object.fromEntries(dbLines.map((r) => [String(Number(r.rt)), Number(r.tx) / 100]));
    report.rateAgreementInvoices = { gstr1: outward, stored: dbOut };
    expect(outward).toEqual(dbOut);
    // credit note: GSTR-1 CDNR rate vs stored ar.credit_debit_notes.gst_rate_pct
    const cdnr = sumByRate(items(g.cdnr)); const stored = await q1(sql`SELECT gst_rate_pct::numeric::text AS rt, taxable_minor::text AS tx FROM ar.credit_debit_notes WHERE tenant_id = ${T}::uuid AND id = ${ids.cn1.id}::uuid`);
    report.rateAgreementNote = { gstr1Cdnr: cdnr, stored: stored[0] };
    expect(cdnr).toEqual({ [String(Number(stored[0]!.rt))]: Number(stored[0]!.tx) / 100 });
    // gst-ledger OUTPUT rows: stored rate_pct vs tax/taxable derivation (CGST/SGST rows carry half the slab; IGST the full slab)
    const led = await q1(sql`SELECT source_doc_type, gst_type, rate_pct::numeric::text AS rt, taxable_minor::text AS tx, tax_minor::text AS tax FROM gl.finance_gst_ledger
      WHERE tenant_id = ${T}::uuid AND direction = 'output' AND status = 'active' AND taxable_minor <> 0`);
    const bad = led.filter((r) => Math.abs(Number(r.rt) - (Number(r.tax) / Number(r.tx)) * 100) > 0.01);
    report.rateAgreementLedgerDivergent = bad;
    expect(bad).toEqual([]);
  });
});

describe("3. M8: Schedule III over the same books", () => {
  it("P&L, Balance Sheet, Cash Flow render (no 409); 2300 sits under current liabilities; BS balances; cash flow reconciles", async () => {
    const B = "/v1/finance/statements/commercial";
    const all = await call("GET", `${B}/set?fy=${FY}`);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.family).toBe("schedule_iii");
    const bs = all.body.balanceSheet; const pl = all.body.profitAndLoss;
    report.scheduleIII = { totalAssets: bs.totalAssetsMinor, totalEquityAndLiabilities: bs.totalEquityAndLiabilitiesMinor, balanced: bs.balanced, revenue: pl.totalRevenueMinor, expenses: pl.totalExpensesMinor, pat: pl.profitAfterTaxMinor, cashFlowReconciles: all.body.cashFlow.reconciles };
    const cl = Object.fromEntries((bs.equityAndLiabilities.find((g: any) => g.key === "current_liabilities")?.lines ?? []).map((l: any) => [String(l.code), l.amountMinor]));
    expect(cl["2300"]).toBe("3990200"); expect(cl["2301"]).toBe("5000");
    expect(bs.balanced, JSON.stringify(report.scheduleIII)).toBe(true);
    expect(bs.totalAssetsMinor).toBe(bs.totalEquityAndLiabilitiesMinor);
    expect(all.body.cashFlow.reconciles).toBe(true);
    for (const p of ["profit-and-loss", "balance-sheet", "cash-flow"]) expect((await call("GET", `${B}/${p}?fy=${FY}`)).status, p).toBe(200);
  });
});
