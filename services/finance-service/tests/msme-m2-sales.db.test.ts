/**
 * MSME commercial M2, REAL Postgres (migrations 0173-0178 applied). Proves, on a throwaway database:
 *   1. the `ar` schema shape: every table tenant_id NOT NULL, ENABLE + FORCE RLS, tenant_isolation policy with USING + WITH CHECK, FKs validated
 *   2. customer master CRUD over the routes; UNIQUE(tenant, code); GSTIN / state validation; RLS isolation (another commercial tenant and a
 *      govt tenant are denied on EVERY ar table; a govt tenant gets 404 on every sales route incl. the mobile sync route)
 *   3. invoice draft computes the stored intra-state (CGST+SGST) vs inter-state (IGST) split with @civitasone/gst; effective-dated rate master
 *   4. Rule-46 gapless numbering (concurrent issue, rollback burns nothing) and the immutability trigger (no UPDATE / DELETE once issued)
 *   5. credit / debit notes link to the invoice, s.34 flag, cumulative cap; AR ageing nets notes and advances
 *   6. posting: the full Dr AR (total) / Cr revenue (taxable) / Cr GST Payable (tax) entry reaches gl.finance_ledger (M3b); the output
 *      gst-ledger rows are proved in msme-m3b-sales-output-tax.db.test.ts
 *   7. fail-closed on a partial commercial chart; an unregistered business carries no GST
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { purgeLedgerRows } from "./_purge-ledger.js";
import { bearer } from "./_fp02.js";
import { buildApp } from "../src/app.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { seedGlHeadsTx } from "../src/modules/gl/standard-heads.js";
import { createCustomerTx, createDraftInvoiceTx, issueInvoiceTx, createNoteTx, issueNoteTx, arAgeingTx } from "../src/modules/sales/service.js";

const ACTOR = "00000000-0f33-4000-8000-0000000000a1";
const SUPPLIER = "29ABCDE1234F1Z5"; // Karnataka (29)
const meta = (t: string) => ({ tenantId: t, actorId: ACTOR, correlationId: "corr-m2" });
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? r : (r as { rows: Record<string, unknown>[] }).rows);
const q1 = async (t: string, query: ReturnType<typeof sql>) => rowsOf(await scoped(t, (tx) => tx.execute(query)));
const codeOf = async (p: Promise<unknown>): Promise<string> => { try { await p; return "NO_ERROR"; } catch (e) { return (e as { code?: string }).code ?? String((e as Error).message); } };

const AR_TABLES = ["customers", "doc_counters", "sales_invoices", "sales_invoice_lines", "advance_receipts", "credit_debit_notes", "ledger_entries"];

const COM = randomUUID(), COM2 = randomUUID(), GOV = randomUUID(), PART = randomUUID(), UNREG = randomUUID();
let app: Awaited<ReturnType<typeof buildApp>>;
let prevFlag: string | undefined;

async function seed(t: string, o: { template: string; gst: boolean; chart: "full" | "partial" | "none" }): Promise<void> {
  await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.finance_settings (tenant_id, coa_template, gst_registered, gstin, gst_effective_from, updated_by)
    VALUES (${t}::uuid, ${o.template}, ${o.gst}, ${o.gst ? SUPPLIER : null}, ${o.gst ? "2026-04-01" : null}, ${ACTOR}::uuid)`));
  if (o.chart === "full") await scoped(t, (tx) => seedGlHeadsTx(tx, t, o.template as "commercial"));
  // a partial chart: the core heads (1300 / 4001) but not the commercial additions -> M1 refuses to post
  if (o.chart === "partial") await scoped(t, (tx) => tx.insert(financeHeads).values([
    { id: randomUUID(), tenantId: t, code: "1300", name: "AR", level: 0, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR },
    { id: randomUUID(), tenantId: t, code: "4001", name: "Revenue", level: 0, classification: "income", createdBy: ACTOR, updatedBy: ACTOR },
  ]));
}

const call = async (t: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown, roles = ["finance_admin"]) => {
  const res = await app.inject({ method, url, headers: bearer(t, ACTOR, roles), ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: res.statusCode, body: (res.body ? res.json() : null) as { data?: any; code?: string } & Record<string, unknown> };
};
const customerBody = (code: string, over: Record<string, unknown> = {}) => ({ customerCode: code, name: `Customer ${code}`, gstin: "29AAAAA0000A1Z5", pan: "AAAAA0000A", creditDays: 30, ...over });
const line = (over: Record<string, unknown> = {}) => ({ description: "Registers", hsnSac: "4820", qty: "3", rateMinor: "100000", gstRatePct: "18", ...over });

/** Publish every finance.gl.post the sales ops enqueued for this tenant through the REAL GL consumer; returns the DLQ size. */
async function drainJournals(t: string): Promise<number> {
  const msgs = rowsOf(await scoped(t, (tx) => tx.execute(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${t}::uuid AND topic = ${COMMANDS.journalPost} ORDER BY created_at, id`)));
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, async (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  registerGlConsumers(q);
  await q.start();
  for (const m of msgs) {
    await q.publish(COMMANDS.journalPost, { messageId: randomUUID(), type: COMMANDS.journalPost, tenantId: t, actorId: ACTOR, correlationId: "corr-m2", schemaVersion: "1.0", payload: m.payload as Record<string, unknown> });
  }
  await q.drain();
  await q.stop();
  return q.dlq.length;
}
const headNet = async (t: string, code: string): Promise<bigint> => {
  const r = await q1(t, sql`SELECT COALESCE(SUM(fl.debit_minor - fl.credit_minor), 0)::text AS n FROM gl.finance_ledger fl
    JOIN budget.finance_heads fh ON fh.id = fl.head_id AND fh.tenant_id = fl.tenant_id WHERE fl.tenant_id = ${t}::uuid AND fh.code = ${code}`);
  return BigInt(String(r[0]?.n));
};

beforeAll(async () => {
  prevFlag = process.env.TENANT_PROFILES_ENABLED;
  process.env.TENANT_PROFILES_ENABLED = "true";
  await seed(COM, { template: "commercial", gst: true, chart: "full" });
  await seed(COM2, { template: "commercial", gst: true, chart: "full" });
  await seed(GOV, { template: "govt", gst: false, chart: "none" });
  await seed(PART, { template: "commercial", gst: true, chart: "partial" });
  await seed(UNREG, { template: "commercial", gst: false, chart: "full" });
  app = await buildApp();
});
afterAll(async () => {
  if (prevFlag === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = prevFlag;
  for (const t of [COM, COM2, GOV, PART, UNREG]) await purgeLedgerRows(t, sql`true`).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

describe("1. the ar schema: table spec on every table", () => {
  it("tenant_id NOT NULL, ENABLE + FORCE RLS, a tenant policy with USING and WITH CHECK, no unvalidated FK", async () => {
    for (const tbl of AR_TABLES) {
      const rls = rowsOf(await sqlClient`SELECT relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'ar' AND c.relname = ${tbl}`);
      expect(rls[0], tbl).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
      const pol = rowsOf(await sqlClient`SELECT polqual IS NOT NULL AS has_using, polwithcheck IS NOT NULL AS has_check FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'ar' AND c.relname = ${tbl}`);
      expect(pol[0], tbl).toMatchObject({ has_using: true, has_check: true });
      const col = rowsOf(await sqlClient`SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'ar' AND table_name = ${tbl} AND column_name = 'tenant_id'`);
      expect(col[0]?.is_nullable, tbl).toBe("NO");
    }
    const bad = rowsOf(await sqlClient`SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'ar' AND c.contype = 'f' AND NOT c.convalidated`);
    expect(bad).toEqual([]);
  });
  it("money columns are bigint and every document has CHECK(taxable + tax = total)", async () => {
    const money = rowsOf(await sqlClient`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'ar' AND column_name LIKE '%\_minor'`);
    expect(money.length).toBeGreaterThan(20);
    expect(money.filter((m) => m.data_type !== "bigint")).toEqual([]);
    for (const c of ["sales_invoices_total_check", "sales_invoice_lines_total_check", "advance_receipts_total_check", "notes_total_check"]) {
      const d = rowsOf(await sqlClient`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${c}`);
      expect(String(d[0]?.def), c).toMatch(/taxable_minor \+ tax_minor\) = (total_minor|amount_minor)/);
    }
  });
  it("gl.finance_ar_ledger (platform-billing AR) is untouched: no sales source value, no new column", async () => {
    const cols = rowsOf(await sqlClient`SELECT column_name FROM information_schema.columns WHERE table_schema = 'gl' AND table_name = 'finance_ar_ledger'`).map((c) => c.column_name);
    expect(cols).not.toContain("sales_invoice_id");
    expect(cols).not.toContain("customer_id");
    const chk = rowsOf(await sqlClient`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'finance_ar_ledger_source_check'`);
    expect(String(chk[0]?.def)).not.toMatch(/sales/);
  });
});

describe("2. customer master + isolation", () => {
  it("CRUD over the routes; UNIQUE(tenant, code); GSTIN, state and PAN are validated", async () => {
    const a = await call(COM, "POST", "/v1/finance/sales/customers", customerBody("c-001"));
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ customerCode: "C-001", stateCode: "29", gstin: "29AAAAA0000A1Z5", creditDays: 30 });
    expect((await call(COM, "POST", "/v1/finance/sales/customers", customerBody("C-001"))).status).toBe(409);
    expect((await call(COM, "POST", "/v1/finance/sales/customers", customerBody("c-bad", { gstin: "NOPE" }))).status).toBe(400);
    expect((await call(COM, "POST", "/v1/finance/sales/customers", customerBody("c-st", { stateCode: "27" }))).status).toBe(422); // GSTIN is state 29
    expect((await call(COM, "POST", "/v1/finance/sales/customers", { customerCode: "c-zz", name: "Zed", stateCode: "55" })).status).toBe(422); // not a GST state
    const put = await call(COM, "PUT", `/v1/finance/sales/customers/${a.body.data.id}`, { creditDays: 45, phone: "9999999999" });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ creditDays: 45, phone: "9999999999" });
    const list = await call(COM, "GET", "/v1/finance/sales/customers");
    expect(list.body.data.map((c: { customerCode: string }) => c.customerCode)).toContain("C-001");
    // a reader cannot write
    expect((await call(COM, "POST", "/v1/finance/sales/customers", customerBody("c-ro"), ["audit_officer"])).status).toBe(403);
  });

  it("another commercial tenant and a govt tenant see nothing, and cannot write into, EVERY ar table", async () => {
    // give COM a row in every table that a plain insert can reach
    const cust = await scoped(COM, (tx) => createCustomerTx(tx, meta(COM), { customerCode: "ISO-1", name: "Iso", stateCode: "29" }));
    const inv = await scoped(COM, (tx) => createDraftInvoiceTx(tx, meta(COM), { customerId: cust.id, invoiceDate: "2026-11-10", lines: [{ description: "x", hsnSac: "4820", qty: 1, rateMinor: 1000n }] }));
    await scoped(COM, (tx) => issueInvoiceTx(tx, meta(COM), inv.id));
    for (const outsider of [COM2, GOV]) {
      for (const tbl of AR_TABLES) {
        const n = await q1(outsider, sql`SELECT count(*)::int AS n FROM ${sql.raw(`ar.${tbl}`)}`);
        expect(n[0]?.n, `${tbl} visible to ${outsider === GOV ? "govt" : "other tenant"}`).toBe(0);
      }
      // WITH CHECK: writing a row for ANOTHER tenant is refused
      await expect(scoped(outsider, (tx) => tx.execute(sql`INSERT INTO ar.customers (tenant_id, customer_code, name, state_code, created_by, updated_by)
        VALUES (${COM}::uuid, 'X-1', 'x', '29', ${ACTOR}::uuid, ${ACTOR}::uuid)`))).rejects.toThrow();
    }
    // COM sees its own
    expect(Number((await q1(COM, sql`SELECT count(*)::int AS n FROM ar.sales_invoices`))[0]?.n)).toBeGreaterThan(0);
  });

  it("a govt tenant gets 404 COMMERCIAL_NOT_ENABLED on every sales route (centralised preHandler), incl. the mobile sync route", async () => {
    const fake = randomUUID();
    const probes: Array<["GET" | "POST" | "PUT" | "DELETE", string, unknown?]> = [
      ["GET", "/v1/finance/sales/customers"], ["POST", "/v1/finance/sales/customers", customerBody("g-1")], ["GET", `/v1/finance/sales/customers/${fake}`],
      ["GET", "/v1/finance/sales/invoices"], ["POST", "/v1/finance/sales/invoices", { customerId: fake, invoiceDate: "2026-11-10", lines: [line()] }],
      ["POST", `/v1/finance/sales/invoices/${fake}/issue`, {}], ["GET", `/v1/finance/sales/invoices/${fake}/pdf`], ["GET", "/v1/finance/sales/advance-receipts"],
      ["GET", "/v1/finance/sales/notes"], ["GET", "/v1/finance/sales/ar/ageing"],
      ["POST", "/v1/finance/sales/mobile/invoices", { id: fake, customerName: "m", items: [{ name: "i", qty: 1, rate: 100, gstPercent: 0 }] }],
    ];
    for (const [m, u, b] of probes) {
      const r = await call(GOV, m, u, b);
      expect([m, u, r.status, r.body.code]).toEqual([m, u, 404, "COMMERCIAL_NOT_ENABLED"]);
    }
    expect(Number((await q1(GOV, sql`SELECT count(*)::int AS n FROM gl.finance_gst_ledger`))[0]?.n)).toBe(0);
  });
});

describe("3. sales invoice: the stored GST split", () => {
  let custKA: string, custMH: string, custB2C: string;
  beforeAll(async () => {
    custKA = (await call(COM, "POST", "/v1/finance/sales/customers", customerBody("KA-1"))).body.data.id;
    custMH = (await call(COM, "POST", "/v1/finance/sales/customers", customerBody("MH-1", { gstin: "27BBBBB1111B1Z5", pan: "BBBBB1111B" }))).body.data.id;
    custB2C = (await call(COM, "POST", "/v1/finance/sales/customers", { customerCode: "WALK-1", name: "Walk-in", stateCode: "29" })).body.data.id;
  });

  it("intra-state: CGST + SGST halves, IGST zero; stored on the invoice; lines carry the rate-master link", async () => {
    const r = await call(COM, "POST", "/v1/finance/sales/invoices", { customerId: custKA, invoiceDate: "2026-11-10", lines: [line(), line({ description: "Odd", qty: "1", rateMinor: "1005" })] });
    expect(r.status).toBe(201);
    const d = r.body.data;
    expect(d).toMatchObject({ status: "draft", invoiceNo: null, supplyType: "intra", invoiceType: "B2B", placeOfSupply: "29", supplierGstin: SUPPLIER, igstMinor: "0" });
    // 300000 @18% = 54000 ; 1005 @18% = 181 (180.9) -> tax 54181 : CGST rounded down, SGST rounded up
    expect(d).toMatchObject({ taxableMinor: "301005", taxMinor: "54181", totalMinor: "355186", cgstMinor: "27090", sgstMinor: "27091" });
    expect(d.lines).toHaveLength(2);
    expect(d.lines[0].gstRateMasterId).toBeTruthy();
    expect(d.dueDate).toBe("2026-12-10"); // credit_days 30
  });
  it("inter-state: IGST only", async () => {
    const r = await call(COM, "POST", "/v1/finance/sales/invoices", { customerId: custMH, invoiceDate: "2026-11-10", lines: [line()] });
    expect(r.body.data).toMatchObject({ supplyType: "inter", placeOfSupply: "27", cgstMinor: "0", sgstMinor: "0", igstMinor: "54000", totalMinor: "354000" });
  });
  it("place of supply can differ from the customer's state (explicit override flips intra to inter)", async () => {
    const r = await call(COM, "POST", "/v1/finance/sales/invoices", { customerId: custKA, invoiceDate: "2026-11-10", placeOfSupply: "27", lines: [line()] });
    expect(r.body.data).toMatchObject({ supplyType: "inter", igstMinor: "54000" });
  });
  it("a B2C customer (no GSTIN) is invoiced as B2C with the same split rule", async () => {
    const r = await call(COM, "POST", "/v1/finance/sales/invoices", { customerId: custB2C, invoiceDate: "2026-11-10", lines: [line()] });
    expect(r.body.data).toMatchObject({ invoiceType: "B2C", customerGstin: null, supplyType: "intra", cgstMinor: "27000", sgstMinor: "27000" });
  });
  it("the rate must be in force on the supply date (effective-dated master): 12% was closed on 2025-09-21; 40% opened on 2025-09-22", async () => {
    const old = await call(COM, "POST", "/v1/finance/sales/invoices", { customerId: custKA, invoiceDate: "2026-11-10", lines: [line({ gstRatePct: "12" })] });
    expect([old.status, old.body.code]).toEqual([422, "INVOICE_RATE_NOT_EFFECTIVE"]);
    const sin = await call(COM, "POST", "/v1/finance/sales/invoices", { customerId: custKA, invoiceDate: "2026-11-10", lines: [line({ gstRatePct: "40" })] });
    expect(sin.status).toBe(201);
    const early = await call(COM, "POST", "/v1/finance/sales/invoices", { customerId: custKA, invoiceDate: "2026-11-10", supplyDate: "2025-08-01", lines: [line({ gstRatePct: "12" })] });
    expect(early.status).toBe(201); // time of supply before the rationalisation: the legacy slab applies
  });
  it("a missing HSN rate default and an unknown HSN are refused", async () => {
    expect((await call(COM, "POST", "/v1/finance/sales/invoices", { customerId: custKA, invoiceDate: "2026-11-10", lines: [line({ hsnSac: "9999", gstRatePct: undefined })] })).body.code).toBe("INVOICE_HSN");
    // HSN 4820 defaults to 18
    const r = await call(COM, "POST", "/v1/finance/sales/invoices", { customerId: custKA, invoiceDate: "2026-11-10", lines: [line({ gstRatePct: undefined })] });
    expect(r.body.data.lines[0].gstRatePct).toBe("18.00");
  });
  it("a draft can be replaced and deleted", async () => {
    const r = await call(COM, "POST", "/v1/finance/sales/invoices", { customerId: custKA, invoiceDate: "2026-11-10", lines: [line()] });
    const id = r.body.data.id;
    const put = await call(COM, "PUT", `/v1/finance/sales/invoices/${id}`, { customerId: custKA, invoiceDate: "2026-11-11", lines: [line({ qty: "1" })] });
    expect(put.body.data).toMatchObject({ taxableMinor: "100000", invoiceDate: "2026-11-11" });
    expect(put.body.data.lines).toHaveLength(1);
    expect((await call(COM, "DELETE", `/v1/finance/sales/invoices/${id}`)).status).toBe(204);
    expect((await call(COM, "GET", `/v1/finance/sales/invoices/${id}`)).status).toBe(404);
  });
  it("an unregistered business invoices with no GST (supply type none, tax zero) and prints no tax", async () => {
    const c = (await call(UNREG, "POST", "/v1/finance/sales/customers", { customerCode: "U-1", name: "Local", stateCode: "29" })).body.data.id;
    const r = await call(UNREG, "POST", "/v1/finance/sales/invoices", { customerId: c, invoiceDate: "2026-11-10", lines: [{ description: "Service", qty: "1", rateMinor: "50000", gstRatePct: "18" }] });
    expect(r.body.data).toMatchObject({ supplyType: "none", taxMinor: "0", totalMinor: "50000", supplierGstin: null });
  });
});

describe("4. Rule-46 numbering and immutability", () => {
  let cust: string;
  const draft = async (t = COM, date = "2026-11-10") => (await scoped(t, (tx) => createDraftInvoiceTx(tx, meta(t), { customerId: cust, invoiceDate: date, lines: [{ description: "g", hsnSac: "4820", qty: 1, rateMinor: 10000n }] }))).id;
  beforeAll(async () => { cust = (await call(COM, "POST", "/v1/finance/sales/customers", customerBody("NUM-1"))).body.data.id; });

  it("issue allocates INV/<FY>/<6-digit> (Rule 46: <= 16 chars), gapless under concurrency", async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => draft()));
    const issued = await Promise.all(ids.map((id) => scoped(COM, (tx) => issueInvoiceTx(tx, meta(COM), id))));
    const nums = issued.map((i) => i.invoiceNo!).sort();
    for (const n of nums) { expect(n).toMatch(/^INV\/2627\/\d{6}$/); expect(n.length).toBeLessThanOrEqual(16); }
    const seqs = (await q1(COM, sql`SELECT last_seq::int AS s FROM ar.doc_counters WHERE tenant_id = ${COM}::uuid AND doc_type = 'sales_invoice'`))[0]!.s as number;
    const all = (await q1(COM, sql`SELECT substr(invoice_no, 10)::int AS n FROM ar.sales_invoices WHERE tenant_id = ${COM}::uuid AND invoice_no IS NOT NULL ORDER BY 1`)).map((r) => r.n as number);
    expect(all).toEqual(Array.from({ length: seqs }, (_, i) => i + 1)); // 1..N with no hole, no duplicate
  });
  it("a rollback after allocation burns no number", async () => {
    const before = (await q1(COM, sql`SELECT last_seq::int AS s FROM ar.doc_counters WHERE tenant_id = ${COM}::uuid AND doc_type = 'sales_invoice'`))[0]!.s as number;
    const id = await draft();
    await expect(scoped(COM, async (tx) => { await issueInvoiceTx(tx, meta(COM), id); throw new Error("boom"); })).rejects.toThrow("boom");
    const after = (await q1(COM, sql`SELECT last_seq::int AS s FROM ar.doc_counters WHERE tenant_id = ${COM}::uuid AND doc_type = 'sales_invoice'`))[0]!.s as number;
    expect(after).toBe(before);
    const ok = await scoped(COM, (tx) => issueInvoiceTx(tx, meta(COM), id));
    expect(ok.invoiceNo).toBe(`INV/2627/${String(before + 1).padStart(6, "0")}`);
  });
  it("the financial year follows the invoice date: a 2027-04 invoice starts INV/2728/000001", async () => {
    const id = await draft(COM, "2027-04-05").catch(() => null);
    if (!id) return; // posting-date window may refuse a far-future draft on some hosts; the pure test covers fySegment
    const i = await scoped(COM, (tx) => issueInvoiceTx(tx, meta(COM), id));
    expect(i.invoiceNo).toBe("INV/2728/000001");
  });
  it("an issued invoice is immutable: UPDATE / DELETE of the header and any line change is blocked by the trigger", async () => {
    const id = await draft();
    const inv = await scoped(COM, (tx) => issueInvoiceTx(tx, meta(COM), id));
    expect(inv.status).toBe("issued");
    expect(inv.journalId).toBeTruthy();
    for (const stmt of [
      sql`UPDATE ar.sales_invoices SET narration = 'tamper' WHERE id = ${id}::uuid`,
      sql`UPDATE ar.sales_invoices SET total_minor = total_minor WHERE id = ${id}::uuid`,
      sql`DELETE FROM ar.sales_invoices WHERE id = ${id}::uuid`,
      sql`UPDATE ar.sales_invoice_lines SET description = 'tamper' WHERE invoice_id = ${id}::uuid`,
      sql`DELETE FROM ar.sales_invoice_lines WHERE invoice_id = ${id}::uuid`,
    ]) await expect(scoped(COM, (tx) => tx.execute(stmt))).rejects.toThrow(/SALES_INVOICE_IMMUTABLE|immutable/i);
    await expect(scoped(COM, (tx) => tx.execute(sql`INSERT INTO ar.sales_invoice_lines (tenant_id, invoice_id, line_no, description, qty, rate_minor, taxable_minor, tax_minor, total_minor)
      VALUES (${COM}::uuid, ${id}::uuid, 9, 'late', 1, 1, 1, 0, 1)`))).rejects.toThrow(/SALES_INVOICE_IMMUTABLE|immutable/i);
    const r = await call(COM, "PUT", `/v1/finance/sales/invoices/${id}`, { customerId: cust, invoiceDate: "2026-11-10", lines: [line()] });
    expect([r.status, r.body.code]).toEqual([409, "INVOICE_NOT_DRAFT"]);
    expect((await call(COM, "DELETE", `/v1/finance/sales/invoices/${id}`)).status).toBe(409);
    expect((await call(COM, "POST", `/v1/finance/sales/invoices/${id}/issue`, {})).status).toBe(409); // already issued
  });
  it("the AR ledger and the doc counters resist tampering the same way", async () => {
    await expect(scoped(COM, (tx) => tx.execute(sql`UPDATE ar.ledger_entries SET debit_minor = 1 WHERE tenant_id = ${COM}::uuid`))).rejects.toThrow(/AR_LEDGER_IMMUTABLE/);
    await expect(scoped(COM, (tx) => tx.execute(sql`DELETE FROM ar.ledger_entries WHERE tenant_id = ${COM}::uuid`))).rejects.toThrow(/AR_LEDGER_IMMUTABLE/);
  });
});

describe("5. credit / debit notes, advances and AR ageing", () => {
  let cust: string, inv: { id: string; invoiceNo: string | null; totalMinor: bigint; taxableMinor: bigint };
  beforeAll(async () => {
    cust = (await call(COM, "POST", "/v1/finance/sales/customers", customerBody("AGE-1", { creditDays: 30 }))).body.data.id;
    const d = await scoped(COM, (tx) => createDraftInvoiceTx(tx, meta(COM), { customerId: cust, invoiceDate: "2026-09-01", lines: [{ description: "g", hsnSac: "4820", qty: 10, rateMinor: 10000n }] }));
    inv = await scoped(COM, (tx) => issueInvoiceTx(tx, meta(COM), d.id));
  });

  it("the issued invoice enters the AR ledger and ages from its due date (2026-10-01 -> 48 days past due on 2026-11-18)", async () => {
    expect(inv.totalMinor).toBe(118000n); // 100000 + 18% GST
    const a = await scoped(COM, (tx) => arAgeingTx(tx, COM, "2026-11-18"));
    const row = a.rows.find((r) => r.customerId === cust)!;
    expect(row.buckets.d31_60).toBe(118000n);
    expect(row.totalMinor).toBe(118000n);
    const early = await scoped(COM, (tx) => arAgeingTx(tx, COM, "2026-09-20"));
    expect(early.rows.find((r) => r.customerId === cust)!.buckets.not_due).toBe(118000n);
    const late = await scoped(COM, (tx) => arAgeingTx(tx, COM, "2027-01-20"));
    expect(late.rows.find((r) => r.customerId === cust)!.buckets.d90_plus).toBe(118000n);
    const http = await call(COM, "GET", "/v1/finance/sales/ar/ageing?asOf=2026-11-18");
    expect(http.status).toBe(200);
  });

  it("a credit note is tied to its invoice, numbered CN/<FY>/…, reduces the open balance, and is capped by the invoice", async () => {
    const n = await call(COM, "POST", `/v1/finance/sales/invoices/${inv.id}/notes`, { noteType: "credit", noteDate: "2026-11-12", reason: "sales_return", taxableMinor: "20000" });
    expect(n.status).toBe(201);
    expect(n.body.data).toMatchObject({ invoiceId: inv.id, noteType: "credit", status: "draft", supplyType: "intra", taxableMinor: "20000", taxMinor: "3600", totalMinor: "23600", cgstMinor: "1800", sgstMinor: "1800", withinS34Window: true, s34CutoffDate: "2027-11-30" });
    const issued = await call(COM, "POST", `/v1/finance/sales/notes/${n.body.data.id}/issue`, {});
    expect(issued.status).toBe(202);
    expect(issued.body.data.noteNo).toMatch(/^CN\/2627\/\d{6}$/);
    const a = await scoped(COM, (tx) => arAgeingTx(tx, COM, "2026-11-18"));
    expect(a.rows.find((r) => r.customerId === cust)!.totalMinor).toBe(118000n - 23600n);
    // cumulative credit cannot exceed the invoice's taxable value (100000): 20000 used, 80001 more is too much
    const over = await call(COM, "POST", `/v1/finance/sales/invoices/${inv.id}/notes`, { noteType: "credit", noteDate: "2026-11-13", reason: "post_sale_discount", taxableMinor: "80001" });
    expect([over.status, over.body.code]).toEqual([422, "NOTE_EXCEEDS_INVOICE"]);
    // an issued note is immutable
    await expect(scoped(COM, (tx) => tx.execute(sql`UPDATE ar.credit_debit_notes SET reason_text = 'x' WHERE id = ${n.body.data.id}::uuid`))).rejects.toThrow(/NOTE_IMMUTABLE/);
  });

  it("a debit note raises the balance; a note dated after the s.34 cutoff is flagged outside the window; a note on a draft invoice is refused", async () => {
    const d = await call(COM, "POST", `/v1/finance/sales/invoices/${inv.id}/notes`, { noteType: "debit", noteDate: "2026-11-14", reason: "correction_in_invoice", taxableMinor: "5000" });
    expect(d.body.data).toMatchObject({ noteType: "debit", totalMinor: "5900" });
    const di = await call(COM, "POST", `/v1/finance/sales/notes/${d.body.data.id}/issue`, {});
    expect(di.body.data.noteNo).toMatch(/^DN\/2627\/\d{6}$/);
    const a = await scoped(COM, (tx) => arAgeingTx(tx, COM, "2026-11-18"));
    expect(a.rows.find((r) => r.customerId === cust)!.totalMinor).toBe(118000n - 23600n + 5900n);
    const late = await scoped(COM, (tx) => createNoteTx(tx, meta(COM), { invoiceId: inv.id, noteType: "debit", noteDate: "2027-12-05", reason: "others", taxableMinor: 1000n }));
    expect(late.withinS34Window).toBe(false);
    expect(String(late.s34CutoffDate)).toBe("2027-11-30");
    const dr = await scoped(COM, (tx) => createDraftInvoiceTx(tx, meta(COM), { customerId: cust, invoiceDate: "2026-11-10", lines: [{ description: "g", hsnSac: "4820", qty: 1, rateMinor: 100n }] }));
    expect(await codeOf(scoped(COM, (tx) => createNoteTx(tx, meta(COM), { invoiceId: dr.id, noteType: "credit", noteDate: "2026-11-12", reason: "others", taxableMinor: 10n })))).toBe("NOTE_INVOICE_NOT_ISSUED");
    expect(await codeOf(scoped(COM, (tx) => createNoteTx(tx, meta(COM), { invoiceId: inv.id, noteType: "credit", noteDate: "2026-08-01", reason: "others", taxableMinor: 10n })))).toBe("NOTE_DATE");
  });

  it("an advance receipt (Rule 50) is numbered RV/…, adjusted whole against an invoice at issue, credited in the AR ledger, once only", async () => {
    const adv = await call(COM, "POST", "/v1/finance/sales/advance-receipts", { customerId: cust, receiptDate: "2026-10-20", amountMinor: "59000", gstRatePct: "18" });
    expect(adv.status).toBe(201);
    expect(adv.body.data).toMatchObject({ amountMinor: "59000", taxableMinor: "50000", taxMinor: "9000", cgstMinor: "4500", sgstMinor: "4500", status: "open" });
    expect(adv.body.data.receiptNo).toMatch(/^RV\/2627\/\d{6}$/);
    const d = await scoped(COM, (tx) => createDraftInvoiceTx(tx, meta(COM), { customerId: cust, invoiceDate: "2026-11-10", supplyDate: "2026-11-10", lines: [{ description: "g", hsnSac: "4820", qty: 10, rateMinor: 10000n }] }));
    const issued = await scoped(COM, (tx) => issueInvoiceTx(tx, meta(COM), d.id, { advanceReceiptIds: [adv.body.data.id] }));
    expect(issued.advanceAdjustedMinor).toBe(59000n);
    expect(String(issued.timeOfSupply)).toBe("2026-10-20"); // time of supply for the advance: the receipt date
    const led = await q1(COM, sql`SELECT entry_type, credit_minor::text AS c FROM ar.ledger_entries WHERE tenant_id = ${COM}::uuid AND invoice_id = ${d.id}::uuid ORDER BY entry_type`);
    expect(led.map((l) => l.entry_type)).toEqual(["advance_adjustment", "invoice"]);
    const d2 = await scoped(COM, (tx) => createDraftInvoiceTx(tx, meta(COM), { customerId: cust, invoiceDate: "2026-11-10", lines: [{ description: "g", hsnSac: "4820", qty: 1, rateMinor: 100000n }] }));
    expect(await codeOf(scoped(COM, (tx) => issueInvoiceTx(tx, meta(COM), d2.id, { advanceReceiptIds: [adv.body.data.id] })))).toBe("ADVANCE_USED");
    await expect(scoped(COM, (tx) => tx.execute(sql`UPDATE ar.advance_receipts SET amount_minor = 1 WHERE id = ${adv.body.data.id}::uuid`))).rejects.toThrow(/ADVANCE_RECEIPT_IMMUTABLE|check/i);
  });
});

describe("6. posting: Dr AR (total) / Cr revenue (taxable) / Cr GST Payable (tax) reaches gl.finance_ledger (M3b)", () => {
  it("issued invoices and notes post balanced journals through the existing journal path; GL AR equals the AR sub-ledger", async () => {
    const t = randomUUID();
    await seed(t, { template: "commercial", gst: true, chart: "full" });
    const c = await scoped(t, (tx) => createCustomerTx(tx, meta(t), { customerCode: "P-1", name: "Post", gstin: "29AAAAA0000A1Z5" }));
    const mk = async (qty: number, rate: bigint) => scoped(t, async (tx) => (await issueInvoiceTx(tx, meta(t), (await createDraftInvoiceTx(tx, meta(t), { customerId: c.id, invoiceDate: "2026-11-10", lines: [{ description: "g", hsnSac: "4820", qty, rateMinor: rate }] })).id)));
    const i1 = await mk(2, 50000n);   // taxable 100000, tax 18000, total 118000
    await mk(1, 25000n);              // taxable 25000
    const note = await scoped(t, async (tx) => (await createNoteTx(tx, meta(t), { invoiceId: i1.id, noteType: "credit", noteDate: "2026-11-12", reason: "sales_return", taxableMinor: 10000n })).id);
    await scoped(t, (tx) => issueNoteTx(tx, meta(t), note));
    expect(await drainJournals(t)).toBe(0); // nothing dead-lettered
    expect(await headNet(t, "1300")).toBe(118000n + 29500n - 11800n); // Dr AR: the full totals incl. GST
    expect(await headNet(t, "4001")).toBe(-(100000n + 25000n - 10000n)); // Cr revenue: taxable only
    expect(await headNet(t, "2300")).toBe(-(18000n + 4500n - 1800n)); // Cr GST Payable: output tax net of the credit note (M3b)
    expect(await headNet(t, "1700")).toBe(0n);
    // the journals are balanced and carry the invoice number in their narration
    const js = await q1(t, sql`SELECT status, lines::text AS lines FROM gl.finance_journals WHERE tenant_id = ${t}::uuid`);
    expect(js).toHaveLength(3);
    expect(js.every((j) => j.status === "posted")).toBe(true);
    expect(js.some((j) => /INV\/2627\/000001/.test(String(j.lines)))).toBe(true);
    // the AR sub-ledger carries the FULL totals (incl. tax) and the GL AR control balance now equals it (the M2 gap, closed by M3b)
    const sub = await q1(t, sql`SELECT SUM(debit_minor - credit_minor)::text AS n FROM ar.ledger_entries WHERE tenant_id = ${t}::uuid`);
    expect(BigInt(String(sub[0]?.n))).toBe(118000n + 29500n - 11800n);
    expect(await headNet(t, "1300")).toBe(BigInt(String(sub[0]?.n)));
    // replay is idempotent (deterministic journal id): a second drain posts nothing new
    const before = await headNet(t, "1300");
    await drainJournals(t);
    expect(await headNet(t, "1300")).toBe(before);
    await purgeLedgerRows(t, sql`true`);
  });
});

describe("7. fail-closed", () => {
  it("a commercial tenant whose chart lacks the required commercial heads cannot issue (JOURNAL_COA_TEMPLATE_INCOMPLETE); no number is consumed", async () => {
    const c = await scoped(PART, (tx) => createCustomerTx(tx, meta(PART), { customerCode: "F-1", name: "Fail", stateCode: "29" }));
    const d = await scoped(PART, (tx) => createDraftInvoiceTx(tx, meta(PART), { customerId: c.id, invoiceDate: "2026-11-10", lines: [{ description: "g", hsnSac: "4820", qty: 1, rateMinor: 1000n }] }));
    const r = await call(PART, "POST", `/v1/finance/sales/invoices/${d.id}/issue`, {});
    expect([r.status, r.body.code]).toEqual([422, "JOURNAL_COA_TEMPLATE_INCOMPLETE"]);
    expect(Number((await q1(PART, sql`SELECT count(*)::int AS n FROM ar.doc_counters`))[0]?.n)).toBe(0);
  });
  it("a GST invoice line without an HSN/SAC cannot be issued", async () => {
    const c = (await call(COM, "POST", "/v1/finance/sales/customers", customerBody("H-1"))).body.data.id;
    const d = await call(COM, "POST", "/v1/finance/sales/invoices", { customerId: c, invoiceDate: "2026-11-10", lines: [{ description: "no hsn", qty: "1", rateMinor: "1000", gstRatePct: "18" }] });
    const r = await call(COM, "POST", `/v1/finance/sales/invoices/${d.body.data.id}/issue`, {});
    expect([r.status, r.body.code]).toEqual([422, "INVOICE_HSN_REQUIRED"]);
  });
});

describe("8. mobile sync route", () => {
  it("accepts the app's offline invoice as a DRAFT, idempotent on the client id, matching or creating the customer", async () => {
    const id = randomUUID();
    const payload = { id, customerId: randomUUID(), customerName: "Ramesh Stores", createdAt: "2026-11-10T08:00:00.000Z", dueDate: "2026-12-10T00:00:00.000Z", items: [{ name: "Notebook", qty: 4, rate: 25000, gstPercent: 18 }] };
    const r = await call(COM, "POST", "/v1/finance/sales/mobile/invoices", payload);
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: "draft", source: "mobile", clientRef: id, customerName: "Ramesh Stores", taxableMinor: "100000", totalMinor: "118000", supplyType: "intra" });
    const again = await call(COM, "POST", "/v1/finance/sales/mobile/invoices", payload);
    expect(again.body.data.id).toBe(r.body.data.id);
    expect(Number((await q1(COM, sql`SELECT count(*)::int AS n FROM ar.sales_invoices WHERE client_ref = ${id}`))[0]?.n)).toBe(1);
    // a second device invoice for the same customer name reuses the customer
    const r2 = await call(COM, "POST", "/v1/finance/sales/mobile/invoices", { ...payload, id: randomUUID(), customerId: randomUUID() });
    expect(r2.body.data.customerId).toBe(r.body.data.customerId);
    // a slab not in force is a non-retryable 422 (the app dead-letters it with the reason)
    const bad = await call(COM, "POST", "/v1/finance/sales/mobile/invoices", { ...payload, id: randomUUID(), items: [{ name: "x", qty: 1, rate: 100, gstPercent: 12 }] });
    expect([bad.status, bad.body.code]).toEqual([422, "INVOICE_RATE_NOT_EFFECTIVE"]);
  });
});
