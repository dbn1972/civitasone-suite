/**
 * MSME M3a (real DB, no mocks): AP input tax + per-tax ITC heads + RCM + the GST producer (outbox-in-tx) + ledger uniqueness +
 * effective-dated slab validation + GST-ledger-vs-GL reconciliation + the gates (unregistered commercial / govt = ZERO gst rows).
 *
 * The harness drives the REAL consumers (payments -> GL spine -> GL consumer -> GST consumer) by pumping each tenant's own
 * _outbox.messages rows into one tenant-wrapped MemoryQueue, exactly what the relay does in production.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeVendors, financeDdo } from "../src/modules/masters/schema.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { seedGlHeadsTx } from "../src/modules/gl/standard-heads.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { registerGstConsumers } from "../src/modules/gst/consumer.js";
import { slabsEffectiveOn } from "../src/modules/gst/rate-master.js";
import { isValidGstRate } from "../src/modules/gst/gst-rates.js";
import { fyFromDate } from "../src/modules/hoa/voucher.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR = randomUUID();
const APPROVERS = [randomUUID(), randomUUID()];
const TODAY = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const FY = fyFromDate(TODAY);
const GSTIN = "27AAPFU0939F1ZV";
const SUPPLIER = "29AABCT1332L1ZT";
const rowsOf = (r: unknown): Array<Record<string, any>> => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, any>>;

type Kind = "com_reg" | "com_unreg" | "govt";
interface Fx { tenantId: string; vendorId: string; headId: string; kind: Kind }
const mk = (kind: Kind): Fx => ({ tenantId: randomUUID(), vendorId: randomUUID(), headId: randomUUID(), kind });
const REG = mk("com_reg"), UNREG = mk("com_unreg"), GOV = mk("govt");
const all = [REG, UNREG, GOV];
let prevFlag: string | undefined; let prevRcm: string | undefined; let prevBlocked: string | undefined;

async function seed(t: Fx): Promise<void> {
  const template = t.kind === "govt" ? "govt" : "commercial";
  const registered = t.kind === "com_reg";
  await scoped(t.tenantId, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_settings (tenant_id, coa_template, budget_control, gst_registered, gstin, updated_by)
    VALUES (${t.tenantId}::uuid, ${template}, 'off', ${registered}, ${registered ? GSTIN : null}, ${ACTOR}::uuid)
    ON CONFLICT (tenant_id) DO UPDATE SET coa_template = EXCLUDED.coa_template, budget_control = 'off',
      gst_registered = EXCLUDED.gst_registered, gstin = EXCLUDED.gstin`));
  if (t.kind === "govt") {
    await scoped(t.tenantId, (tx) => tx.insert(financeHeads).values({ id: t.headId, tenantId: t.tenantId, code: "2202", name: "Bill head", level: 1, classification: "expenditure", hoaCode: "220201101010101010", createdBy: ACTOR, updatedBy: ACTOR }));
    await scoped(t.tenantId, (tx) => tx.insert(financeDdo).values({ tenantId: t.tenantId, ddoCode: "DDO123456", name: "DDO", createdBy: ACTOR, updatedBy: ACTOR }).onConflictDoNothing());
    await scoped(t.tenantId, (tx) => tx.insert(financeHeads).values([
      { id: randomUUID(), tenantId: t.tenantId, code: "2050", name: "Accounts Payable control", level: 1, classification: "liability", createdBy: ACTOR, updatedBy: ACTOR },
    ]).onConflictDoNothing());
  } else {
    // The FULL commercial chart (M1 is fail-closed on a partial one): the commercial seed plus the core heads.
    await scoped(t.tenantId, (tx) => seedGlHeadsTx(tx, t.tenantId, "commercial"));
    const h = await scoped(t.tenantId, (tx) => tx.select({ id: financeHeads.id }).from(financeHeads).where(sql`${financeHeads.tenantId} = ${t.tenantId}::uuid AND ${financeHeads.code} = '5400'`));
    t.headId = h[0]!.id;
  }
  await scoped(t.tenantId, (tx) => tx.insert(financeVendors).values({
    id: t.vendorId, tenantId: t.tenantId, name: "Vendor", category: "supplier", pan: "BBBBB1234F", address: "1 Road",
    bankName: "Bank", bankAccountNo: "000111222333", ifsc: "TEST0001234", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await scoped(t.tenantId, (tx) => tx.insert(financeBudgetAllocation).values({
    id: randomUUID(), tenantId: t.tenantId, headId: t.headId, fy: FY, allocatedMinor: 100000000000n, committedMinor: 0n, actualMinor: 0n, createdBy: ACTOR, updatedBy: ACTOR,
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

/** Relay every unpublished outbox row of the tenant whose topic a registered consumer handles, until quiescent. */
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

async function lodge(t: Fx, over: Record<string, unknown>): Promise<{ billId: string; q: MemoryQueue }> {
  const q = tenantQueue(); await q.start();
  const billId = randomUUID();
  await q.publish(COMMANDS.billCreate, {
    messageId: randomUUID(), type: COMMANDS.billCreate, tenantId: t.tenantId, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id: billId, tenantId: t.tenantId, billNo: "M3A", vendorId: t.vendorId, headCode: t.kind === "govt" ? "2202" : "5400", ...(t.kind === "govt" ? { ddoCode: "DDO123456" } : {}), grossMinor: "118000", netMinor: "118000", currency: "INR", deductions: [], poRef: "po:1", grnRef: "grn:1", billDate: TODAY, ...over },
  });
  await q.drain();
  return { billId, q };
}
async function approveBoth(t: Fx, billId: string, q: MemoryQueue): Promise<void> {
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

/** gl.finance_ledger net (Dr - Cr) by head code for one voucher-less tenant. */
async function balances(tenantId: string): Promise<Record<string, bigint>> {
  const r = rowsOf(await scoped(tenantId, (tx) => tx.execute(sql`
    SELECT h.code, COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::text AS bal
      FROM gl.finance_ledger l JOIN budget.finance_heads h ON h.id = l.head_id
     WHERE l.tenant_id = ${tenantId}::uuid GROUP BY h.code`)));
  return Object.fromEntries(r.map((x) => [x.code, BigInt(x.bal)]));
}
const gstRows = (tenantId: string) => scoped(tenantId, (tx) => tx.execute(sql`
  SELECT gst_type, direction, tax_minor::text AS tax, taxable_minor::text AS taxable, rate_pct::float AS rate, itc_category, rcm, gl_head_code,
         source_doc_type, source_doc_id::text AS source_doc_id, journal_id::text AS journal_id, ledger_voucher_no, rcm_itc_claimed_at
    FROM gl.finance_gst_ledger WHERE tenant_id = ${tenantId}::uuid ORDER BY gst_type, rate_pct`)).then(rowsOf);

/** The reconciliation: for every head, SUM(gst ledger tax carried by that head) == that head's balance in gl.finance_ledger. */
async function reconcile(tenantId: string): Promise<void> {
  const bal = await balances(tenantId);
  const sums = rowsOf(await scoped(tenantId, (tx) => tx.execute(sql`
    SELECT gl_head_code AS code, SUM(CASE WHEN direction = 'input' THEN tax_minor ELSE -tax_minor END)::text AS s
      FROM gl.finance_gst_ledger WHERE tenant_id = ${tenantId}::uuid AND gl_head_code IS NOT NULL AND status = 'active' GROUP BY gl_head_code`)));
  expect(sums.length).toBeGreaterThan(0);
  for (const s of sums) expect(BigInt(s.s), `head ${s.code}`).toBe(bal[s.code] ?? 0n);
  // and no ITC head carries a balance the ledger does not explain
  for (const code of ["1701", "1702", "1703", "1704", "1705"]) {
    if ((bal[code] ?? 0n) !== 0n) expect(sums.map((x) => x.code), `${code} unexplained`).toContain(code);
  }
}

beforeAll(async () => {
  prevFlag = process.env.TENANT_PROFILES_ENABLED; prevRcm = process.env.FINANCE_GST_RCM_CATEGORIES; prevBlocked = process.env.FINANCE_GST_ITC_BLOCKED_CATEGORIES;
  process.env.TENANT_PROFILES_ENABLED = "true";
  process.env.FINANCE_GST_RCM_CATEGORIES = "goods_transport";
  process.env.FINANCE_GST_ITC_BLOCKED_CATEGORIES = "motor_vehicle";
  for (const t of all) await seed(t);
});
afterAll(async () => {
  const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore("TENANT_PROFILES_ENABLED", prevFlag); restore("FINANCE_GST_RCM_CATEGORIES", prevRcm); restore("FINANCE_GST_ITC_BLOCKED_CATEGORIES", prevBlocked);
  for (const t of all) {
    for (const stmt of [
      sql`DELETE FROM gl.finance_gst_ledger WHERE tenant_id = ${t.tenantId}::uuid`,
      sql`DELETE FROM gl.finance_ledger WHERE tenant_id = ${t.tenantId}::uuid`,
    ]) await scoped(t.tenantId, (tx) => tx.execute(stmt)).catch(() => undefined);
    await scoped(t.tenantId, (tx) => tx.delete(financeBills).where(eq(financeBills.tenantId, t.tenantId))).catch(() => undefined);
  }
  void db;
});

const lineIGST5 = { gstType: "IGST", ratePct: 5, taxableMinor: "100000", taxMinor: "5000" };
const cgstSgst9 = [
  { gstType: "CGST", ratePct: 9, taxableMinor: "100000", taxMinor: "9000" },
  { gstType: "SGST", ratePct: 9, taxableMinor: "100000", taxMinor: "9000" },
];

describe("AP bill on a GST-registered commercial tenant posts input tax to per-tax ITC heads and emits one ledger row per tax line", () => {
  let billId = ""; let q: MemoryQueue;
  it("intra-state: Dr purchases 100000, Dr CGST ITC 9000, Dr SGST ITC 9000, Cr AP 118000; two gst rows linked to the voucher", async () => {
    ({ billId, q } = await lodge(REG, { vendorBillNo: "INV-77", gst: { supplierGstin: SUPPLIER, rcm: false, lines: cgstSgst9 } }));
    expect(dlq(q)).toBe("");
    await approveBoth(REG, billId, q);
    expect(dlq(q)).toBe("");
    const b = await balances(REG.tenantId);
    expect(b["5400"]).toBe(100000n); expect(b["1702"]).toBe(9000n); expect(b["1703"]).toBe(9000n); expect(b["2050"]).toBe(-118000n);
    expect(b["1700"] ?? 0n).toBe(0n); // the coarse legacy head is not used
    const rows = await gstRows(REG.tenantId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.gst_type)).toEqual(["CGST", "SGST"]);
    for (const r of rows) {
      expect(r.direction).toBe("input"); expect(r.tax).toBe("9000"); expect(r.itc_category).toBe("eligible");
      expect(r.source_doc_type).toBe("bill"); expect(r.source_doc_id).toBe(billId); expect(r.journal_id).toBeTruthy();
      expect(r.ledger_voucher_no).toMatch(/\S/);
    }
    const v = rowsOf(await scoped(REG.tenantId, (tx) => tx.execute(sql`SELECT DISTINCT voucher_no FROM gl.finance_ledger WHERE tenant_id = ${REG.tenantId}::uuid`)));
    expect(v.map((x) => x.voucher_no)).toContain(rows[0]!.ledger_voucher_no);
  });
  it("re-delivery is idempotent: the same entries again (new message ids) leave exactly two rows", async () => {
    const outboxRows = rowsOf(await scoped(REG.tenantId, (tx) => tx.execute(sql`
      SELECT actor_id, correlation_id, payload FROM _outbox.messages WHERE tenant_id = ${REG.tenantId}::uuid AND topic = 'finance.gst.entry_record'`)));
    expect(outboxRows.length).toBe(2);
    const q2 = tenantQueue(); await q2.start();
    for (const r of outboxRows) await q2.publish("finance.gst.entry_record", { messageId: randomUUID(), type: "finance.gst.entry_record", tenantId: REG.tenantId, actorId: r.actor_id, correlationId: r.correlation_id, schemaVersion: "1.0", payload: r.payload });
    await q2.drain();
    expect(dlq(q2)).toBe("");
    expect(await gstRows(REG.tenantId)).toHaveLength(2);
  });
  it("the unique key is enforced by the database for a different message too", async () => {
    await expect(scoped(REG.tenantId, (tx) => tx.execute(sql`
      INSERT INTO gl.finance_gst_ledger (tenant_id, invoice_date, gst_type, direction, taxable_minor, tax_minor, rate_pct, period, source_doc_type, source_doc_id)
      VALUES (${REG.tenantId}::uuid, ${TODAY}::date, 'CGST', 'input', 1, 1, 9, ${TODAY.slice(0, 7)}, 'bill', ${billId}::uuid)`))).rejects.toThrow();
  });
  it("reconciliation: gst ledger sum by head == the head's balance in gl.finance_ledger", async () => { await reconcile(REG.tenantId); });

  it("inter-state IGST goes to the IGST ITC head", async () => {
    const { billId: b2, q: q2 } = await lodge(REG, { grossMinor: "105000", netMinor: "105000", gst: { rcm: false, lines: [lineIGST5] } });
    await approveBoth(REG, b2, q2);
    expect(dlq(q2)).toBe("");
    expect((await balances(REG.tenantId))["1701"]).toBe(5000n);
    await reconcile(REG.tenantId);
  });
  it("ITC categorisation: a configured s.17(5) blocked line is costed into the expense, no ITC head, ledger row categorised blocked", async () => {
    const T = mk("com_reg"); all.push(T); await seed(T);
    const { billId: b3, q: q3 } = await lodge(T, { grossMinor: "105000", netMinor: "105000", gst: { rcm: false, lines: [{ ...lineIGST5, itcCategory: "eligible", blockCategory: "motor_vehicle" }] } });
    await approveBoth(T, b3, q3);
    expect(dlq(q3)).toBe("");
    const b = await balances(T.tenantId);
    expect(b["5400"]).toBe(105000n); expect(b["1701"] ?? 0n).toBe(0n);
    const r = await gstRows(T.tenantId);
    expect(r).toHaveLength(1); expect(r[0]!.itc_category).toBe("blocked"); expect(r[0]!.gl_head_code).toBeNull();
  });
});

describe("RCM: three-leg entry, conservative config, ITC after the tax is paid", () => {
  it("an RCM bill whose category is not configured is refused at lodging (nothing stored)", async () => {
    const { billId, q } = await lodge(REG, { grossMinor: "100000", netMinor: "100000", gst: { rcm: true, rcmCategory: "legal_services", lines: [lineIGST5] } });
    expect(dlq(q)).toMatch(/GST_RCM_CATEGORY_NOT_CONFIGURED/);
    expect(await scoped(REG.tenantId, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, billId)))).toHaveLength(0);
  });
  it("posts Dr expense / Dr ITC-RCM-pending / Cr AP / Cr RCM payable, allocates a self-invoice, and claims the ITC after payment", async () => {
    const T = mk("com_reg"); all.push(T); await seed(T);
    const { billId, q } = await lodge(T, { grossMinor: "100000", netMinor: "100000", gst: { rcm: true, rcmCategory: "goods_transport", lines: [lineIGST5] } });
    expect(dlq(q)).toBe("");
    const bill = (await scoped(T.tenantId, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, billId))))[0]!;
    expect(bill.rcm).toBe(true); expect(bill.rcmSelfInvoiceNo).toMatch(/RCMINV/);
    await approveBoth(T, billId, q);
    expect(dlq(q)).toBe("");
    let b = await balances(T.tenantId);
    expect(b["5400"]).toBe(100000n); expect(b["1705"]).toBe(5000n); expect(b["2050"]).toBe(-100000n); expect(b["2301"]).toBe(-5000n);
    expect(b["1701"] ?? 0n).toBe(0n);
    await reconcile(T.tenantId);
    // the RCM tax is paid -> the ITC moves to the IGST head
    await q.publish("finance.gst.rcm_itc_claim", {
      messageId: randomUUID(), type: "finance.gst.rcm_itc_claim", tenantId: T.tenantId, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: T.tenantId, billId, paidOn: TODAY, challanRef: "CHALLAN-1" },
    });
    await q.drain(); await pump(q, T.tenantId);
    expect(dlq(q)).toBe("");
    b = await balances(T.tenantId);
    expect(b["1705"] ?? 0n).toBe(0n); expect(b["1701"]).toBe(5000n);
    const r = await gstRows(T.tenantId);
    expect(r[0]!.gl_head_code).toBe("1701"); expect(r[0]!.rcm_itc_claimed_at).toBeTruthy();
    await reconcile(T.tenantId);
  });
});

describe("Gates: an unregistered commercial tenant and a govt tenant produce ZERO gst_ledger rows", () => {
  it.each([UNREG, GOV])("$kind: a bill carrying GST lines is refused at lodging; a plain bill posts the unchanged two-line journal", async (t) => {
    const refused = await lodge(t, { grossMinor: "105000", netMinor: "105000", gst: { rcm: false, lines: [lineIGST5] } });
    expect(dlq(refused.q)).toMatch(/GST_NOT_REGISTERED/);
    const plain = await lodge(t, { grossMinor: "50000", netMinor: "50000" });
    await approveBoth(t, plain.billId, plain.q);
    const b = await balances(t.tenantId);
    expect(b[t.kind === "govt" ? "2202" : "5400"]).toBe(50000n); expect(b["2050"]).toBe(-50000n);
    for (const c of ["1701", "1702", "1703", "1704", "1705", "2301"]) expect(b[c] ?? 0n).toBe(0n);
    expect(await gstRows(t.tenantId)).toHaveLength(0);
  });
  it.each([UNREG, GOV])("$kind: consumer defense in depth - a stray finance.gst.entry_record is refused, nothing written", async (t) => {
    const q = tenantQueue(); await q.start();
    await q.publish("finance.gst.entry_record", {
      messageId: randomUUID(), type: "finance.gst.entry_record", tenantId: t.tenantId, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: t.tenantId, invoiceNo: "X", invoiceDate: TODAY, partyGstin: SUPPLIER, gstType: "IGST", direction: "output", taxableMinor: "100", taxMinor: "5", ratePct: 5, period: TODAY.slice(0, 7) },
    });
    await q.drain();
    expect(dlq(q)).toMatch(/GST_NOT_REGISTERED/);
    expect(await gstRows(t.tenantId)).toHaveLength(0);
  });
  it("a GST-bearing journal on an unregistered tenant is REFUSED whole: no ledger line, no gst message", async () => {
    const q = tenantQueue(); await q.start();
    const id = randomUUID();
    await q.publish(COMMANDS.journalPost, {
      messageId: randomUUID(), type: COMMANDS.journalPost, tenantId: UNREG.tenantId, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: UNREG.tenantId, voucherNo: "AUTO", type: "bill", postingDate: TODAY,
        lines: [{ accountCode: "5400", debitMinor: "100", creditMinor: "0" }, { accountCode: "2050", debitMinor: "0", creditMinor: "100" }],
        gst: { sourceDocType: "bill", sourceDocId: randomUUID(), invoiceNo: "Z", invoiceDate: TODAY, entries: [{ gstType: "IGST", ratePct: 5, taxableMinor: "100", taxMinor: "5", itcCategory: "eligible", rcm: false, glHeadCode: "1701" }] } },
    });
    await q.drain();
    expect(dlq(q)).toMatch(/GST_NOT_REGISTERED/);
    const j = rowsOf(await scoped(UNREG.tenantId, (tx) => tx.execute(sql`SELECT 1 FROM gl.finance_journals WHERE id = ${id}::uuid`)));
    expect(j).toHaveLength(0);
    const m = rowsOf(await scoped(UNREG.tenantId, (tx) => tx.execute(sql`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${UNREG.tenantId}::uuid AND topic = 'finance.gst.entry_record'`)));
    expect(m).toHaveLength(0);
  });
});

describe("Slab validation reads the effective-dated rate master (2025-09-22 rationalisation)", () => {
  it("12% / 28% are in force before 2025-09-22 and gone after; 40% is the reverse", async () => {
    const before = await db.transaction((tx) => slabsEffectiveOn(tx, "2025-06-10"));
    const after = await db.transaction((tx) => slabsEffectiveOn(tx, "2026-01-10"));
    expect(before).toContain(12); expect(before).toContain(28); expect(before).not.toContain(40);
    expect(after).not.toContain(12); expect(after).not.toContain(28); expect(after).toContain(40); expect(after).toContain(18);
    expect(isValidGstRate(12, "IGST", before)).toBe(true); expect(isValidGstRate(12, "IGST", after)).toBe(false);
    expect(isValidGstRate(40, "IGST", after)).toBe(true); expect(isValidGstRate(20, "CGST", after)).toBe(true); expect(isValidGstRate(6, "CGST", before)).toBe(true);
    expect(isValidGstRate(6, "CGST", after)).toBe(false);
  });
  it("a date before the first effective_from has no slab: refused (GST_RATE_MASTER_EMPTY), no silent fallback", async () => {
    await expect(db.transaction((tx) => slabsEffectiveOn(tx, "2010-01-01"))).rejects.toThrow(/GST_RATE_MASTER_EMPTY/);
  });
  it("the consumer applies it: a 12% IGST entry dated after the cut-over is refused, one dated before is recorded", async () => {
    const q = tenantQueue(); await q.start();
    const mkEntry = (date: string) => ({
      messageId: randomUUID(), type: "finance.gst.entry_record", tenantId: REG.tenantId, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: REG.tenantId, invoiceNo: `S-${date}`, invoiceDate: date, partyGstin: SUPPLIER, gstType: "IGST", direction: "output", taxableMinor: "100000", taxMinor: "12000", ratePct: 12, period: date.slice(0, 7) },
    });
    await q.publish("finance.gst.entry_record", mkEntry("2026-01-10")); await q.drain();
    expect(dlq(q)).toMatch(/GST_RATE_INVALID/);
    const q2 = tenantQueue(); await q2.start();
    await q2.publish("finance.gst.entry_record", mkEntry("2025-06-10")); await q2.drain();
    expect(dlq(q2)).toBe("");
  });
});
