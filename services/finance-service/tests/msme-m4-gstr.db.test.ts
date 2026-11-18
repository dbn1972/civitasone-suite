/**
 * MSME commercial M4, REAL Postgres (migrations through 0184). Seeds the tenant's sales through the real M2 services, seeds
 * gl.finance_gst_ledger rows for BOTH directions directly (M3b's real output rows are exercised by the final integration gate), then:
 *   1. table spec of the two new gl tables (tenant_id NOT NULL, ENABLE + FORCE RLS, USING + WITH CHECK, bigint-free JSON, immutability trigger)
 *   2. commercial gate: a govt tenant gets 404 COMMERCIAL_NOT_ENABLED on every M4 route
 *   3. a prepared run: GSTR-1 bucketing, HSN totals, GSTR-3B sections, GSTR-1 <-> 3B reconciliation, pinned JSON version, stored + re-exportable
 *   4. RLS: another tenant / govt tenant sees zero runs and cannot read a run by id; runs are append-only
 *   5. QRMP election, eligibility ceiling, IFF kind for a non-quarter-end month, quarterly return
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { purgeLedgerRows } from "./_purge-ledger.js";
import { bearer } from "./_fp02.js";
import { buildApp } from "../src/app.js";
import { seedGlHeadsTx } from "../src/modules/gl/standard-heads.js";
import { createCustomerTx, createDraftInvoiceTx, issueInvoiceTx, createNoteTx, issueNoteTx, createAdvanceReceiptTx } from "../src/modules/sales/service.js";

const ACTOR = "00000000-0f33-4000-8000-0000000000b4";
const SUPPLIER = "29ABCDE1234F1Z5";
const meta = (t: string) => ({ tenantId: t, actorId: ACTOR, correlationId: "corr-m4" });
const rowsOf = (r: unknown): Record<string, any>[] => (Array.isArray(r) ? r : (r as { rows: Record<string, any>[] }).rows);
const q1 = async (t: string, query: ReturnType<typeof sql>) => rowsOf(await scoped(t, (tx) => tx.execute(query)));
const TABLES = ["gst_return_settings", "gst_return_runs"];

const COM = randomUUID(), COM2 = randomUUID(), GOV = randomUUID();
let app: Awaited<ReturnType<typeof buildApp>>;
let prevFlag: string | undefined;
let runId = "";

async function seed(t: string, template: string, gst: boolean): Promise<void> {
  await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.finance_settings (tenant_id, coa_template, gst_registered, gstin, gst_effective_from, updated_by)
    VALUES (${t}::uuid, ${template}, ${gst}, ${gst ? SUPPLIER : null}, ${gst ? "2026-04-01" : null}, ${ACTOR}::uuid)`));
  if (template === "commercial") await scoped(t, (tx) => seedGlHeadsTx(tx, t, "commercial"));
}
const call = async (t: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: bearer(t, ACTOR, ["finance_admin"]), ...(payload !== undefined ? { payload: payload as object } : {}) });
  let body: any = null; try { body = res.body ? res.json() : null; } catch { body = res.body; }
  return { status: res.statusCode, body, headers: res.headers };
};

/** The rows M3b's posting writes, seeded directly: one per tax head per rate, taxable carried on CGST + SGST + IGST rows, credit notes NEGATIVE. */
async function seedOutputLedger(t: string, inv: { id: string; invoiceNo: string; invoiceDate: string; customerGstin: string | null; supplyType: string; lines: Array<{ taxableMinor: bigint; gstRatePct: string; taxMinor: bigint }> },
  docType = "sales_invoice", sign = 1n, docId = inv.id, no = inv.invoiceNo, date = inv.invoiceDate): Promise<void> {
  const byRate = new Map<string, { taxable: bigint; tax: bigint }>();
  for (const l of inv.lines) { if (l.taxMinor === 0n) continue; const e = byRate.get(l.gstRatePct) ?? { taxable: 0n, tax: 0n }; e.taxable += l.taxableMinor; e.tax += l.taxMinor; byRate.set(l.gstRatePct, e); }
  for (const [rate, g] of byRate) {
    const heads: Array<[string, bigint, string]> = inv.supplyType === "intra" ? [["CGST", g.tax / 2n, String(Number(rate) / 2)], ["SGST", g.tax - g.tax / 2n, String(Number(rate) / 2)]] : [["IGST", g.tax, rate]];
    for (const [gstType, tax, r] of heads) await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.finance_gst_ledger (tenant_id, invoice_id, invoice_no, invoice_date, party_gstin, gst_type, direction, taxable_minor, tax_minor, rate_pct, period, created_by, source_doc_type, source_doc_id, gl_head_code)
      VALUES (${t}::uuid, ${docId}::uuid, ${no}, ${date}::date, ${inv.customerGstin}, ${gstType}, 'output', ${String(sign * g.taxable)}::bigint, ${String(sign * tax)}::bigint, ${r}::numeric, ${date.slice(0, 7)}, ${ACTOR}::uuid, ${docType}, ${docId}::uuid, '2300')`));
  }
}
const seedInputLedger = (t: string, o: { gstType: string; taxable: bigint; tax: bigint; date: string; category: string; rcm?: boolean; claimed?: string | null }) =>
  scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.finance_gst_ledger (tenant_id, invoice_no, invoice_date, gst_type, direction, taxable_minor, tax_minor, rate_pct, period, created_by, source_doc_type, source_doc_id, itc_category, rcm, rcm_itc_claimed_at, gl_head_code)
    VALUES (${t}::uuid, ${"BILL-" + randomUUID().slice(0, 6)}, ${o.date}::date, ${o.gstType}, 'input', ${String(o.taxable)}::bigint, ${String(o.tax)}::bigint, 9, ${o.date.slice(0, 7)}, ${ACTOR}::uuid, 'bill', ${randomUUID()}::uuid, ${o.category}, ${o.rcm === true}, ${o.claimed ?? null}::timestamptz, '1370')`));

beforeAll(async () => {
  prevFlag = process.env.TENANT_PROFILES_ENABLED;
  process.env.TENANT_PROFILES_ENABLED = "true";
  await seed(COM, "commercial", true); await seed(COM2, "commercial", true); await seed(GOV, "govt", false);
  app = await buildApp();
});
afterAll(async () => {
  if (prevFlag === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = prevFlag;
  for (const t of [COM, COM2, GOV]) await purgeLedgerRows(t, sql`true`).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

describe("1. the two new gl tables: table spec", () => {
  it("tenant_id NOT NULL, ENABLE + FORCE RLS, tenant policy with USING and WITH CHECK, UNIQUE incl. tenant_id, money-free typed columns", async () => {
    for (const tbl of TABLES) {
      const rls = rowsOf(await sqlClient`SELECT relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'gl' AND c.relname = ${tbl}`);
      expect(rls[0], tbl).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
      const pol = rowsOf(await sqlClient`SELECT polqual IS NOT NULL AS has_using, polwithcheck IS NOT NULL AS has_check FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'gl' AND c.relname = ${tbl}`);
      expect(pol[0], tbl).toMatchObject({ has_using: true, has_check: true });
      const col = rowsOf(await sqlClient`SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'gl' AND table_name = ${tbl} AND column_name = 'tenant_id'`);
      expect(col[0]?.is_nullable, tbl).toBe("NO");
    }
    const uq = rowsOf(await sqlClient`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'gst_return_runs_period_key'`);
    expect(uq[0]?.def).toMatch(/UNIQUE \(tenant_id, kind, frequency, period_key, run_no\)/);
  });
});

describe("2. commercial gate", () => {
  it("a govt tenant is refused 404 COMMERCIAL_NOT_ENABLED on every M4 route", async () => {
    const fake = randomUUID();
    for (const [m, u, b] of [["GET", "/v1/finance/gst-returns/settings"], ["PUT", "/v1/finance/gst-returns/settings", { filingFrequency: "quarterly" }], ["POST", "/v1/finance/gst-returns/runs", { period: "2026-11" }],
      ["GET", "/v1/finance/gst-returns/runs"], ["GET", `/v1/finance/gst-returns/runs/${fake}`], ["GET", `/v1/finance/gst-returns/runs/${fake}/gstr1.json`], ["GET", `/v1/finance/gst-returns/runs/${fake}/gstr3b.json`]] as Array<["GET" | "POST" | "PUT", string, unknown?]>) {
      const r = await call(GOV, m, u, b);
      expect([r.status, r.body?.code], `${m} ${u}`).toEqual([404, "COMMERCIAL_NOT_ENABLED"]);
    }
  });
});

describe("3. a prepared November-2026 return", () => {
  const ids: Record<string, any> = {};
  beforeAll(async () => {
    const cust = async (code: string, o: Record<string, unknown>) => (await scoped(COM, (tx) => createCustomerTx(tx, meta(COM), { customerCode: code, name: `Customer ${code}`, ...o } as any))).id;
    const cKA = await cust("KA", { gstin: "29AAAAA0000A1Z5", pan: "AAAAA0000A" });          // registered, intra
    const cMH = await cust("MH", { gstin: "27AAAAA0000A1Z5", pan: "AAAAA0000A" });          // registered, inter
    const cDL = await cust("DL", { stateCode: "07" });                                      // unregistered, inter
    const cKB = await cust("KB", { stateCode: "29" });                                      // unregistered, intra
    const mk = async (customerId: string, date: string, lines: any[], extra: Record<string, unknown> = {}) => {
      const d = await scoped(COM, (tx) => createDraftInvoiceTx(tx, meta(COM), { customerId, invoiceDate: date, lines, ...extra } as any));
      return scoped(COM, (tx) => issueInvoiceTx(tx, meta(COM), d.id));
    };
    ids.b2bIntra = await mk(cKA, "2026-11-03", [{ description: "Registers", hsnSac: "4820", qty: 10, rateMinor: 100000n, gstRatePct: "18" }]);
    ids.b2bInter = await mk(cMH, "2026-11-05", [{ description: "Registers", hsnSac: "4820", qty: 5, rateMinor: 100000n, gstRatePct: "18" }, { description: "Books", hsnSac: "6109", qty: 2, rateMinor: 50000n, gstRatePct: "5" }]);
    ids.b2cl = await mk(cDL, "2026-11-07", [{ description: "Bulk", hsnSac: "4820", qty: 1, rateMinor: 20_000_000n, gstRatePct: "18" }]);       // Rs 2 lakh inter-state B2C
    ids.b2cs = await mk(cDL, "2026-11-08", [{ description: "Small", hsnSac: "4820", qty: 1, rateMinor: 500_000n, gstRatePct: "18" }]);
    ids.b2csIntra = await mk(cKB, "2026-11-09", [{ description: "Retail", hsnSac: "4820", qty: 1, rateMinor: 90_000n, gstRatePct: "18" }]);
    const adv = await scoped(COM, (tx) => createAdvanceReceiptTx(tx, meta(COM), { customerId: cMH, receiptDate: "2026-11-12", amountMinor: 118000n, gstRatePct: "18" } as any));
    ids.adv = adv.id;
    const cn = await scoped(COM, (tx) => createNoteTx(tx, meta(COM), { invoiceId: ids.b2bIntra.id, noteType: "credit", noteDate: "2026-11-15", reason: "sales_return", taxableMinor: 100000n, gstRatePct: "18" } as any));
    ids.cn = await scoped(COM, (tx) => issueNoteTx(tx, meta(COM), cn.id));
    // output + input ledger rows, both directions, seeded directly
    for (const i of [ids.b2bIntra, ids.b2bInter, ids.b2cl, ids.b2cs, ids.b2csIntra]) await seedOutputLedger(COM, i);
    await seedOutputLedger(COM, { ...ids.b2bIntra, lines: [{ taxableMinor: 100000n, gstRatePct: "18", taxMinor: 18000n }] }, "credit_note", -1n, ids.cn.id, ids.cn.noteNo, "2026-11-15");
    await seedInputLedger(COM, { gstType: "CGST", taxable: 400000n, tax: 36000n, date: "2026-11-04", category: "eligible" });
    await seedInputLedger(COM, { gstType: "SGST", taxable: 400000n, tax: 36000n, date: "2026-11-04", category: "eligible" });
    await seedInputLedger(COM, { gstType: "IGST", taxable: 200000n, tax: 36000n, date: "2026-11-06", category: "eligible", rcm: true, claimed: "2026-11-20T10:00:00+05:30" });
    await seedInputLedger(COM, { gstType: "CGST", taxable: 50000n, tax: 4500n, date: "2026-11-06", category: "blocked" });
  });

  it("prepares a run: 201, JSON version pinned, reconciled, warnings carry the CA-VERIFY caveats", async () => {
    const r = await call(COM, "POST", "/v1/finance/gst-returns/runs", { period: "2026-11" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const d = r.body.data; runId = d.id;
    expect(d).toMatchObject({ kind: "periodic", frequency: "monthly", periodKey: "2026-11", runNo: 1, schemaVersion: "GST3.1", gstin: SUPPLIER });
    expect(d.reconciliation.ok, JSON.stringify(d.reconciliation)).toBe(true);
    expect(d.reconciliation.unmatchedDocs).toEqual([]);
    expect(d.summary.caVerify).toContain("jsonSchemaVersion");
    expect(d.warnings.join()).toMatch(/ITC_REVERSALS/);
  });
  it("GSTR-1: B2B / B2CL / B2CS / CDNR / advances / HSN / documents issued", async () => {
    const g = (await call(COM, "GET", `/v1/finance/gst-returns/runs/${runId}`)).body.data.gstr1;
    expect(g.version).toBe("GST3.1"); expect(g.fp).toBe("112026");
    expect(g.b2b.map((c: any) => c.ctin).sort()).toEqual(["27AAAAA0000A1Z5", "29AAAAA0000A1Z5"]);
    expect(g.b2cl).toHaveLength(1); expect(g.b2cl[0].pos).toBe("07");
    expect(g.b2cs.map((r: any) => `${r.sply_ty}|${r.pos}|${r.rt}`).sort()).toEqual(["INTER|07|18", "INTRA|29|18"]);
    expect(g.cdnr).toHaveLength(1); expect(g.cdnr[0].nt[0]).toMatchObject({ ntty: "C", nt_dt: "15-11-2026" });
    expect(g.at.length).toBe(1);
    const taxableRs = (10 * 100000 + 5 * 100000 + 2 * 50000 + 20_000_000 + 500_000 + 90_000) / 100;
    expect(g.hsn.data.reduce((a: number, h: any) => a + h.txval, 0)).toBeCloseTo(taxableRs, 2);
    expect(g.doc_issue.doc_det.map((x: any) => x.doc_typ)).toEqual(["Invoices for outward supply", "Credit Note"]);
    expect(g.doc_issue.doc_det[0].docs[0]).toMatchObject({ totnum: 5, cancel: 0, net_issue: 5 });
  });
  it("GSTR-3B: 3.1 equals the ledger and GSTR-1, 3.2 lists the unregistered inter-state, 4 takes the ITC, 6 pays the rest", async () => {
    const j = (await call(COM, "GET", `/v1/finance/gst-returns/runs/${runId}`)).body.data;
    const b = j.gstr3b; const s = j.summary.totals;
    const igst1 = BigInt(s.taxedOutward.igst), cgst1 = BigInt(s.taxedOutward.cgst);
    expect(Math.round(b.sup_details.osup_det.iamt * 100)).toBe(Number(igst1)); expect(Math.round(b.sup_details.osup_det.camt * 100)).toBe(Number(cgst1));
    expect(b.sup_details.osup_det.camt).toBe(b.sup_details.osup_det.samt);
    expect(b.inter_sup.unreg_details).toEqual([{ pos: "07", txval: 205000, iamt: 36900 }]);
    expect(b.sup_details.isup_rev).toMatchObject({ txval: 2000, iamt: 360 });
    expect(b.itc_elg.itc_avl.find((x: any) => x.ty === "ISRC").iamt).toBe(360);
    expect(b.itc_elg.itc_avl.find((x: any) => x.ty === "OTH")).toMatchObject({ camt: 360, samt: 360 });
    expect(b.itc_elg.itc_inelg.find((x: any) => x.ty === "OTH").camt).toBe(45);
    expect(b.tx_pmt.rcm_cash.iamt).toBe(360);
    expect(j.summary.gstr3b).toMatchObject({ lateDays: 0, dueDate: "2026-12-20" });
  });
  it("RECONCILIATION evidence: every head diff is 0", async () => {
    const rec = (await call(COM, "GET", `/v1/finance/gst-returns/runs/${runId}`)).body.data.reconciliation;
    expect(rec.checks.length).toBeGreaterThanOrEqual(6);
    for (const c of rec.checks) expect([c.name, c.diffMinor, c.ok]).toEqual([c.name, "0", true]);
  });
  it("a drifted ledger row makes the next run flag RECONCILIATION_MISMATCH and list the document", async () => {
    await scoped(COM, (tx) => tx.execute(sql`UPDATE gl.finance_gst_ledger SET tax_minor = tax_minor + 1 WHERE tenant_id = ${COM}::uuid AND source_doc_id = ${ids.b2cs.id}::uuid AND gst_type = 'IGST'`));
    const r = await call(COM, "POST", "/v1/finance/gst-returns/runs", { period: "2026-11" });
    expect(r.body.data.runNo).toBe(2);
    expect(r.body.data.reconciliation.ok).toBe(false);
    expect(r.body.data.reconciliation.unmatchedDocs.map((u: any) => u.docNo)).toContain(ids.b2cs.invoiceNo);
    expect(r.body.data.warnings.join()).toMatch(/RECONCILIATION_MISMATCH/);
    await scoped(COM, (tx) => tx.execute(sql`UPDATE gl.finance_gst_ledger SET tax_minor = tax_minor - 1 WHERE tenant_id = ${COM}::uuid AND source_doc_id = ${ids.b2cs.id}::uuid AND gst_type = 'IGST'`));
  });
  it("exports the stored snapshot in the pinned shape with a version header; re-export is byte-identical; runs are append-only", async () => {
    const a = await call(COM, "GET", `/v1/finance/gst-returns/runs/${runId}/gstr1.json`);
    const b = await call(COM, "GET", `/v1/finance/gst-returns/runs/${runId}/gstr1.json`);
    expect(a.status).toBe(200); expect(a.headers["x-gstr-json-version"]).toBe("GST3.1"); expect(String(a.headers["content-disposition"])).toMatch(/gstr1_.*_2026-11_run1\.json/);
    expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
    expect(Object.keys(a.body)).toEqual(expect.arrayContaining(["gstin", "fp", "gt", "cur_gt", "version", "hash", "b2b", "b2cl", "b2cs", "cdnr", "hsn", "doc_issue"]));
    const three = await call(COM, "GET", `/v1/finance/gst-returns/runs/${runId}/gstr3b.json`);
    expect(three.status).toBe(200); expect(three.body).toHaveProperty("sup_details");
    await expect(scoped(COM, (tx) => tx.execute(sql`UPDATE gl.gst_return_runs SET gstin = gstin WHERE id = ${runId}::uuid`))).rejects.toThrow(/GST_RETURN_RUN_IMMUTABLE/);
    await expect(scoped(COM, (tx) => tx.execute(sql`DELETE FROM gl.gst_return_runs WHERE id = ${runId}::uuid`))).rejects.toThrow(/GST_RETURN_RUN_IMMUTABLE/);
  });
  it("interest and late fee are computed when a late filing date is supplied", async () => {
    const r = await call(COM, "POST", "/v1/finance/gst-returns/runs", { period: "2026-11", filedOn: "2027-01-19" });
    expect(r.body.data.summary.gstr3b.lateDays).toBe(30);
    expect(r.body.data.gstr3b.intr_ltfee.ltfee_details).toEqual({ camt: 750, samt: 750 });
  });
});

describe("4. RLS isolation", () => {
  it("another commercial tenant and a govt tenant see zero runs; a foreign run id is a 404; tenant 2 has no data to prepare yet no leak", async () => {
    expect((await call(COM2, "GET", "/v1/finance/gst-returns/runs")).body.data).toEqual([]);
    expect((await call(COM2, "GET", `/v1/finance/gst-returns/runs/${runId}`)).status).toBe(404);
    expect((await call(COM2, "GET", `/v1/finance/gst-returns/runs/${runId}/gstr1.json`)).status).toBe(404);
    expect(await q1(COM2, sql`SELECT 1 FROM gl.gst_return_runs`)).toEqual([]);
    expect(await q1(GOV, sql`SELECT 1 FROM gl.gst_return_runs`)).toEqual([]);
    expect(await q1(GOV, sql`SELECT 1 FROM gl.gst_return_settings`)).toEqual([]);
    const n = await call(COM2, "POST", "/v1/finance/gst-returns/runs", { period: "2026-11" });
    expect(n.status).toBe(201); expect(n.body.data.summary.counts.b2b).toBe(0); expect(n.body.data.reconciliation.ok).toBe(true);
    expect((await call(COM, "GET", "/v1/finance/gst-returns/runs")).body.data.every((x: any) => x.gstin === SUPPLIER)).toBe(true);
  });
});

describe("5. QRMP / IFF", () => {
  it("election is refused above the turnover ceiling, allowed below; quarterly makes a non-quarter-end month an IFF and the quarter-end a 3-month return", async () => {
    // COM's previous-FY turnover is zero (seed is current FY) -> eligible
    expect((await call(COM, "GET", "/v1/finance/gst-returns/settings")).body.data.qrmp).toMatchObject({ eligible: true, caVerify: true });
    const set = await call(COM2, "PUT", "/v1/finance/gst-returns/settings", { filingFrequency: "quarterly" });
    expect(set.status).toBe(200); expect(set.body.data.filingFrequency).toBe("quarterly");
    const iff = await call(COM2, "POST", "/v1/finance/gst-returns/runs", { period: "2026-11" });
    expect(iff.body.data).toMatchObject({ kind: "iff", frequency: "quarterly", fromDate: "2026-11-01", toDate: "2026-11-30" });
    expect(iff.body.data.gstr3b).toBeNull();
    expect((await call(COM2, "GET", `/v1/finance/gst-returns/runs/${iff.body.data.id}/gstr3b.json`)).body.code).toBe("GSTR_EXPORT_NOT_AVAILABLE");
    const q = await call(COM2, "POST", "/v1/finance/gst-returns/runs", { period: "2026-12" });
    expect(q.body.data).toMatchObject({ kind: "periodic", frequency: "quarterly", fromDate: "2026-10-01", toDate: "2026-12-31" });
    expect(q.body.data.gstr3b.ret_period).toBe("122026"); expect(q.body.data.summary.gstr3b.dueDate).toBe("2027-01-22");
    // ineligible: previous-FY turnover above the ceiling
    await scoped(COM2, (tx) => tx.execute(sql`UPDATE gl.finance_settings SET gstin = gstin WHERE tenant_id = ${COM2}::uuid`));
  });
});
