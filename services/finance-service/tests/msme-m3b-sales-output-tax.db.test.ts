/**
 * MSME M3b, REAL Postgres (migrations through 0183), real consumers: the GST OUTPUT line on sales documents.
 *   - an issued invoice posts Dr AR 1300 (total) / Cr revenue 4001 (taxable) / Cr GST Payable 2300 (tax); GL AR == ar.ledger_entries
 *   - one output gl.finance_gst_ledger row per tax type and rate, summing exactly to the stored CGST / SGST / IGST, via M3a's producer
 *   - credit note reverses the GST line (negative rows, s.34); debit note adds it; the gst-ledger <-> GL reconciliation holds (output)
 *   - an unregistered commercial tenant and a govt tenant post NO GST line and write NO gst row
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { purgeLedgerRows } from "./_purge-ledger.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { registerGstConsumers } from "../src/modules/gst/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { seedGlHeadsTx } from "../src/modules/gl/standard-heads.js";
import { createCustomerTx, createDraftInvoiceTx, issueInvoiceTx, createNoteTx, issueNoteTx } from "../src/modules/sales/service.js";

const ACTOR = "00000000-0f33-4000-8000-0000000000b3";
const SUPPLIER = "29ABCDE1234F1Z5"; // Karnataka (29)
const meta = (t: string) => ({ tenantId: t, actorId: ACTOR, correlationId: "corr-m3b" });
const rowsOf = (r: unknown): Record<string, any>[] => (Array.isArray(r) ? r : (r as { rows: Record<string, any>[] }).rows);
const q1 = async (t: string, query: ReturnType<typeof sql>) => rowsOf(await scoped(t, (tx) => tx.execute(query)));

const REG = randomUUID(), UNREG = randomUUID(), GOV = randomUUID();

async function seed(t: string, o: { template: string; gst: boolean; chart: boolean }): Promise<void> {
  await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.finance_settings (tenant_id, coa_template, gst_registered, gstin, gst_effective_from, updated_by)
    VALUES (${t}::uuid, ${o.template}, ${o.gst}, ${o.gst ? SUPPLIER : null}, ${o.gst ? "2026-04-01" : null}, ${ACTOR}::uuid)`));
  if (o.chart) await scoped(t, (tx) => seedGlHeadsTx(tx, t, o.template as "commercial"));
}

/** Run the REAL gl + gst consumers over every journal / gst-entry message this tenant enqueued; returns the DLQ text. */
async function pump(t: string): Promise<string> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (m: any) => Promise<void>) => raw(topic, (m: any) => runWithTenant(m.tenantId, () => handler(m)));
  registerGlConsumers(q); registerGstConsumers(q);
  await q.start();
  const topics = new Set([COMMANDS.journalPost, "finance.gst.entry_record"]);
  for (let i = 0; i < 6; i++) {
    const rows = rowsOf(await scoped(t, (tx) => tx.execute(sql`
      SELECT id, topic, actor_id, correlation_id, payload FROM _outbox.messages WHERE tenant_id = ${t}::uuid AND published_at IS NULL ORDER BY created_at`))).filter((r) => topics.has(r.topic));
    if (rows.length === 0) break;
    for (const r of rows) {
      await scoped(t, (tx) => tx.execute(sql`UPDATE _outbox.messages SET published_at = now() WHERE id = ${r.id}::uuid`));
      await q.publish(r.topic, { messageId: r.id, type: r.topic, tenantId: t, actorId: r.actor_id, correlationId: r.correlation_id, schemaVersion: "1.0", payload: r.payload });
    }
    await q.drain();
  }
  await q.stop();
  return q.dlq.map((d) => String(d.error)).join(" | ");
}
const headNet = async (t: string, code: string): Promise<bigint> => {
  const r = await q1(t, sql`SELECT COALESCE(SUM(fl.debit_minor - fl.credit_minor), 0)::text AS n FROM gl.finance_ledger fl
    JOIN budget.finance_heads fh ON fh.id = fl.head_id AND fh.tenant_id = fl.tenant_id WHERE fl.tenant_id = ${t}::uuid AND fh.code = ${code}`);
  return BigInt(String(r[0]?.n));
};
const subLedger = async (t: string): Promise<bigint> =>
  BigInt(String((await q1(t, sql`SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::text AS n FROM ar.ledger_entries WHERE tenant_id = ${t}::uuid`))[0]?.n));
const gstRows = (t: string, docType?: string) => q1(t, sql`SELECT gst_type, direction, rate_pct::text AS rate, taxable_minor::text AS taxable, tax_minor::text AS tax, gl_head_code, source_doc_type, journal_id
  FROM gl.finance_gst_ledger WHERE tenant_id = ${t}::uuid AND (${docType ?? null}::text IS NULL OR source_doc_type = ${docType ?? null}) ORDER BY source_doc_type, gst_type, rate_pct`);
/** M3a reconciliation, both directions: sum(gst ledger by head) == GL head balance (input +, output -). */
async function reconcile(t: string): Promise<number> {
  const sums = await q1(t, sql`SELECT gl_head_code AS code, SUM(CASE WHEN direction = 'input' THEN tax_minor ELSE -tax_minor END)::text AS s
    FROM gl.finance_gst_ledger WHERE tenant_id = ${t}::uuid AND gl_head_code IS NOT NULL AND status = 'active' GROUP BY gl_head_code`);
  for (const s of sums) expect(BigInt(s.s), `head ${s.code}`).toBe(await headNet(t, String(s.code)));
  return sums.length;
}

let prevFlag: string | undefined;
beforeAll(async () => {
  prevFlag = process.env.TENANT_PROFILES_ENABLED;
  await seed(REG, { template: "commercial", gst: true, chart: true });
  await seed(UNREG, { template: "commercial", gst: false, chart: true });
  await seed(GOV, { template: "govt", gst: false, chart: false });
});
afterAll(async () => {
  if (prevFlag === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = prevFlag;
  for (const t of [REG, UNREG, GOV]) {
    await scoped(t, (tx) => tx.execute(sql`DELETE FROM gl.finance_gst_ledger WHERE tenant_id = ${t}::uuid`)).catch(() => undefined);
    await purgeLedgerRows(t, sql`true`).catch(() => undefined);
  }
  await sqlClient.end();
});

describe("M3b: sales output GST", () => {
  let intra: { id: string }; let inter: { id: string };
  it("intra-state multi-rate invoice posts Dr AR total / Cr revenue taxable / Cr 2300 tax, with CGST+SGST rows per rate summing to the stored split", async () => {
    const c = await scoped(REG, (tx) => createCustomerTx(tx, meta(REG), { customerCode: "O-1", name: "Intra", gstin: "29AAAAA0000A1Z5" }));
    const d = await scoped(REG, (tx) => createDraftInvoiceTx(tx, meta(REG), { customerId: c.id, invoiceDate: "2026-11-10", lines: [
      { description: "a", hsnSac: "4820", qty: 1, rateMinor: 100000n, gstRatePct: 18 }, { description: "b", hsnSac: "4820", qty: 1, rateMinor: 50001n, gstRatePct: 5 }] }));
    expect(d.taxMinor).toBe(18000n + 2500n /* 2500.05 -> 2500 */);
    intra = await scoped(REG, (tx) => issueInvoiceTx(tx, meta(REG), d.id));
    expect(await pump(REG)).toBe("");
    const lines = await q1(REG, sql`SELECT h.code, l.debit_minor::text AS dr, l.credit_minor::text AS cr FROM gl.finance_ledger l JOIN budget.finance_heads h ON h.id = l.head_id WHERE l.tenant_id = ${REG}::uuid ORDER BY h.code`);
    expect(lines.map((l) => [l.code, l.dr, l.cr])).toEqual([["1300", "170501", "0"], ["2300", "0", "20500"], ["4001", "0", "150001"]]);
    expect(await headNet(REG, "1300")).toBe(await subLedger(REG)); // the M2 gap is closed
    const rows = await gstRows(REG, "sales_invoice");
    expect(rows.every((r) => r.direction === "output" && r.gl_head_code === "2300" && r.journal_id)).toBe(true);
    expect(rows.map((r) => [r.gst_type, r.rate, r.taxable, r.tax])).toEqual([
      ["CGST", "2.50", "50001", "1250"], ["CGST", "9.00", "100000", "9000"], ["SGST", "2.50", "50001", "1250"], ["SGST", "9.00", "100000", "9000"]]);
    expect(rows.reduce((a, r) => a + BigInt(r.tax), 0n)).toBe(20500n);
    expect(rows.filter((r) => r.gst_type === "CGST").reduce((a, r) => a + BigInt(r.tax), 0n)).toBe(d.cgstMinor);
    expect(await reconcile(REG)).toBe(1);
  });

  it("inter-state invoice carries IGST rows; replay (re-pump) adds no second row", async () => {
    const c = await scoped(REG, (tx) => createCustomerTx(tx, meta(REG), { customerCode: "O-2", name: "Inter", gstin: "27AAAAA0000A1Z5" }));
    const d = await scoped(REG, (tx) => createDraftInvoiceTx(tx, meta(REG), { customerId: c.id, invoiceDate: "2026-11-11", lines: [{ description: "a", hsnSac: "4820", qty: 1, rateMinor: 100000n, gstRatePct: 18 }] }));
    inter = await scoped(REG, (tx) => issueInvoiceTx(tx, meta(REG), d.id));
    expect(await pump(REG)).toBe("");
    const rows = await gstRows(REG, "sales_invoice");
    const igst = rows.filter((r) => r.gst_type === "IGST");
    expect(igst.map((r) => [r.rate, r.tax])).toEqual([["18.00", "18000"]]);
    const n = rows.length; await pump(REG);
    expect((await gstRows(REG, "sales_invoice")).length).toBe(n);
    expect(await headNet(REG, "2300")).toBe(-(20500n + 18000n));
    expect(await headNet(REG, "1300")).toBe(await subLedger(REG));
    expect(await reconcile(REG)).toBe(1);
  });

  it("a credit note reverses the GST line proportionally (negative rows); a debit note adds it; AR and the reconciliation still hold", async () => {
    const cn = await scoped(REG, async (tx) => (await createNoteTx(tx, meta(REG), { invoiceId: intra.id, noteType: "credit", noteDate: "2026-11-12", reason: "sales_return", taxableMinor: 10000n, gstRatePct: 18 })).id);
    await scoped(REG, (tx) => issueNoteTx(tx, meta(REG), cn));
    const dn = await scoped(REG, async (tx) => (await createNoteTx(tx, meta(REG), { invoiceId: inter.id, noteType: "debit", noteDate: "2026-11-13", reason: "correction_in_invoice", taxableMinor: 5000n, gstRatePct: 18 })).id);
    await scoped(REG, (tx) => issueNoteTx(tx, meta(REG), dn));
    expect(await pump(REG)).toBe("");
    const c = await gstRows(REG, "credit_note");
    expect(c.map((r) => [r.gst_type, r.rate, r.taxable, r.tax])).toEqual([["CGST", "9.00", "-10000", "-900"], ["SGST", "9.00", "-10000", "-900"]]);
    const d = await gstRows(REG, "debit_note");
    expect(d.map((r) => [r.gst_type, r.rate, r.taxable, r.tax])).toEqual([["IGST", "18.00", "5000", "900"]]);
    expect(await headNet(REG, "2300")).toBe(-(20500n + 18000n - 1800n + 900n)); // credit note debits 2300, debit note credits it
    expect(await headNet(REG, "1300")).toBe(await subLedger(REG));
    expect(await reconcile(REG)).toBe(1);
    // output liability per the existing itc-reconciliation shape nets the credit note
    const liab = await q1(REG, sql`SELECT SUM(CASE WHEN direction = 'output' THEN tax_minor ELSE 0 END)::text AS o FROM gl.finance_gst_ledger WHERE tenant_id = ${REG}::uuid`);
    expect(BigInt(liab[0]!.o)).toBe(20500n + 18000n - 1800n + 900n);
  });

  it.each(["true", "false"])("an unregistered commercial tenant posts NO GST line and writes NO gst row (TENANT_PROFILES_ENABLED=%s)", async (flag) => {
    process.env.TENANT_PROFILES_ENABLED = flag;
    const c = await scoped(UNREG, (tx) => createCustomerTx(tx, meta(UNREG), { customerCode: `U-${flag}`, name: "Unreg", stateCode: "29" }));
    const d = await scoped(UNREG, (tx) => createDraftInvoiceTx(tx, meta(UNREG), { customerId: c.id, invoiceDate: "2026-11-10", lines: [{ description: "a", qty: 1, rateMinor: 100000n }] }));
    expect(d.taxMinor).toBe(0n);
    const inv = await scoped(UNREG, (tx) => issueInvoiceTx(tx, meta(UNREG), d.id));
    const n = await scoped(UNREG, async (tx) => (await createNoteTx(tx, meta(UNREG), { invoiceId: inv.id, noteType: "credit", noteDate: "2026-11-12", reason: "others", taxableMinor: 1000n })).id);
    await scoped(UNREG, (tx) => issueNoteTx(tx, meta(UNREG), n));
    expect(await pump(UNREG)).toBe("");
    expect(await headNet(UNREG, "2300")).toBe(0n);
    expect(await headNet(UNREG, "1300")).toBe(await subLedger(UNREG));
    expect((await gstRows(UNREG)).length).toBe(0);
    expect(await q1(UNREG, sql`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${UNREG}::uuid AND topic = 'finance.gst.entry_record'`)).toEqual([]);
  });

  it.each(["true", "false"])("a govt tenant can neither issue a sales document with GST nor write a gst row / 2300 line (TENANT_PROFILES_ENABLED=%s)", async (flag) => {
    process.env.TENANT_PROFILES_ENABLED = flag;
    let refused = false;
    try {
      const c = await scoped(GOV, (tx) => createCustomerTx(tx, meta(GOV), { customerCode: `G-${flag}`, name: "Gov" }));
      const d = await scoped(GOV, (tx) => createDraftInvoiceTx(tx, meta(GOV), { customerId: c.id, invoiceDate: "2026-11-10", lines: [{ description: "a", hsnSac: "4820", qty: 1, rateMinor: 100000n, gstRatePct: 18 }] }));
      await scoped(GOV, (tx) => issueInvoiceTx(tx, meta(GOV), d.id));
    } catch { refused = true; }
    expect(refused).toBe(true);
    await pump(GOV);
    expect((await gstRows(GOV)).length).toBe(0);
    expect(await q1(GOV, sql`SELECT 1 FROM gl.finance_ledger WHERE tenant_id = ${GOV}::uuid`)).toEqual([]);
  });
});
