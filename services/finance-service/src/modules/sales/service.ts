/**
 * MSME commercial M2 -- customer master, sales invoice, advance receipt, credit / debit note and AR sub-ledger services.
 * Everything runs inside the caller's tenant-scoped transaction (RLS on every ar.* table).
 *
 * POSTING (M2 + M3b): issuing a document books the FULL entry to gl.finance_ledger through the EXISTING journal path
 * (enqueueSpineJournal -> finance.gl.post -> gl/consumer.ts, which is NOT edited here):
 *     invoice / debit note:  Dr AR control (1300) total   Cr Sales revenue (4001) taxable   Cr GST Payable (2300) output tax
 *     credit note:           Dr Sales revenue (4001) taxable   Dr GST Payable (2300) tax    Cr AR control (1300) total
 * so the GL AR balance equals the ar.ledger_entries sub-ledger. The commercial chart has ONE output-tax head (2300); the CGST / SGST /
 * IGST split lives on the gl.finance_gst_ledger rows (gl_head_code 2300), emitted with direction "output" through M3a's producer
 * (`extra.gst` -> emitGstEntriesTx, in the posting tx). A credit note's rows carry NEGATIVE taxable / tax (s.34 reduction of output
 * liability). The GST line and rows exist ONLY for a GST-registered, non-govt-chart tenant; otherwise tax is 0 and nothing changes.
 *
 * Gate: these functions are reached only through routes.ts, behind the centralised commercial-tenant preHandler
 * (shared/commercial-gate.ts); no function here checks a tenant type.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { GSTIN_RE, splitIntraStateTax } from "@civitasone/gst";
import { allocateReference } from "@civitasone/numbering";
import { DomainError } from "../approvals/domain.js";
import { auditEvent, type ActorMeta } from "../approvals/apply.js";
import { loadPostingSettingsTx } from "../approvals/posting-settings.js";
import { financeSettings } from "../approvals/schema.js";
import { assertCommercialChartReadyTx } from "../gl/commercial-chart.js";
import { deterministicId, enqueueSpineJournal } from "../gl/spine.js";
import type { GstLedgerEntry, GstJournalMeta } from "../gst/itc.js";
import { periodPostingRefusal } from "../gl/posting-rules.js";
import { fyClosedReasonTx, fyClosedMessage } from "../gl/fy-guard.js";
import { fyFromDate } from "../hoa/voucher.js";
import { getPeriodStatusTx } from "../period-close/repo.js";
import {
  arCustomers, salesInvoices, salesInvoiceLines, advanceReceipts, creditDebitNotes, arLedgerEntries,
  type ArCustomerRow, type SalesInvoiceRow, type SalesInvoiceLineRow, type AdvanceReceiptRow, type CreditDebitNoteRow,
  type NoteReason, type NoteType, type SupplyType,
} from "./schema.js";
import {
  AR_SEQ_CONFIG, ageingBucket, computeInvoice, computeNote, fySegment, mintInstant, specFor, s34Cutoff, splitTax, withinS34, assertRule46,
  AGEING_BUCKETS, type AgeingBucket, type DocType, type LineInput,
} from "./domain.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;
type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { rows?: Row[] })?.rows ?? [])) as Row[];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The head codes the sales postings use. Core heads present in every chart; env-overridable like the other producers. */
export const AR_CONTROL_CODE = (): string => process.env.FINANCE_AR_CONTROL_CODE?.trim() || "1300";
export const SALES_REVENUE_CODE = (): string => process.env.FINANCE_SALES_REVENUE_CODE?.trim() || "4001";
/** Output GST (GST Payable on outward supplies). Fixed commercial-chart head (gl/standard-heads.ts); CGST/SGST/IGST are split on the gst ledger rows. */
export const GST_PAYABLE_CODE = "2300";

// ---- business identity (stored settings) ---------------------------------------------------------------------------------------

export type Business = { gstRegistered: boolean; gstin: string | null; coaTemplate: string };

export async function loadBusinessTx(tx: Tx, tenantId: string): Promise<Business> {
  const [r] = await tx.select({ g: financeSettings.gstRegistered, n: financeSettings.gstin, c: financeSettings.coaTemplate })
    .from(financeSettings).where(eq(financeSettings.tenantId, tenantId)).limit(1);
  return { gstRegistered: r?.g === true, gstin: r?.n ?? null, coaTemplate: r?.c ?? "govt" };
}

// ---- customers -----------------------------------------------------------------------------------------------------------------

export type CustomerInput = {
  customerCode: string; name: string; gstin?: string | undefined; stateCode?: string | undefined; pan?: string | undefined; address?: string | undefined;
  email?: string | undefined; phone?: string | undefined; creditDays?: number | undefined; creditLimitMinor?: bigint | undefined;
};

async function assertStateCodeTx(tx: Tx, code: string): Promise<void> {
  const r = rowsOf(await tx.execute(sql`SELECT is_active FROM gl.finance_gst_state_codes WHERE code = ${code} LIMIT 1`))[0];
  if (!r) throw new DomainError("CUSTOMER_STATE", `'${code}' is not a GST state code`);
  if (r.is_active === false) throw new DomainError("CUSTOMER_STATE", `state code ${code} is no longer in use`);
}

function normaliseCustomer(i: CustomerInput): { stateCode: string; gstin: string | null; pan: string | null } {
  const gstin = i.gstin ? i.gstin.trim().toUpperCase() : null;
  if (gstin && !GSTIN_RE.test(gstin)) throw new DomainError("CUSTOMER_GSTIN", "customer GSTIN is not a valid 15-character GSTIN");
  const stateCode = i.stateCode ?? (gstin ? gstin.slice(0, 2) : undefined);
  if (!stateCode) throw new DomainError("CUSTOMER_STATE", "a customer needs a state code (or a GSTIN, which carries it)");
  if (gstin && gstin.slice(0, 2) !== stateCode) throw new DomainError("CUSTOMER_STATE", "the GSTIN state does not match the customer's state code");
  const pan = i.pan ? i.pan.trim().toUpperCase() : null;
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new DomainError("CUSTOMER_PAN", "PAN is not valid");
  if (gstin && pan && gstin.slice(2, 12) !== pan) throw new DomainError("CUSTOMER_PAN", "the PAN does not match the GSTIN");
  return { stateCode, gstin, pan };
}

export async function createCustomerTx(tx: Tx, meta: ActorMeta, i: CustomerInput): Promise<ArCustomerRow> {
  const n = normaliseCustomer(i);
  await assertStateCodeTx(tx, n.stateCode);
  const inserted = await tx.insert(arCustomers).values({
    tenantId: meta.tenantId, customerCode: i.customerCode.trim().toUpperCase(), name: i.name.trim(), gstin: n.gstin, stateCode: n.stateCode, pan: n.pan,
    address: i.address ?? null, email: i.email ?? null, phone: i.phone ?? null, creditDays: i.creditDays ?? 0, creditLimitMinor: i.creditLimitMinor ?? null,
    createdBy: meta.actorId, updatedBy: meta.actorId,
  }).onConflictDoNothing({ target: [arCustomers.tenantId, arCustomers.customerCode] }).returning();
  const row = inserted[0];
  if (!row) throw new DomainError("CUSTOMER_EXISTS", `customer code ${i.customerCode} is already used`);
  await auditEvent(tx, meta, "create_customer", "ar_customer", row.id, { customerCode: row.customerCode });
  return row;
}

export async function updateCustomerTx(tx: Tx, meta: ActorMeta, id: string, i: { [K in keyof CustomerInput]?: CustomerInput[K] | undefined } & { isActive?: boolean | undefined }): Promise<ArCustomerRow> {
  const cur = await getCustomerTx(tx, meta.tenantId, id);
  const merged: CustomerInput = {
    customerCode: cur.customerCode, name: i.name ?? cur.name, gstin: i.gstin ?? cur.gstin ?? undefined,
    stateCode: i.stateCode ?? (i.gstin ? undefined : cur.stateCode), pan: i.pan ?? cur.pan ?? undefined,
  };
  const n = normaliseCustomer(merged);
  await assertStateCodeTx(tx, n.stateCode);
  const [row] = await tx.update(arCustomers).set({
    name: merged.name.trim(), gstin: n.gstin, stateCode: n.stateCode, pan: n.pan,
    ...(i.address !== undefined ? { address: i.address } : {}), ...(i.email !== undefined ? { email: i.email } : {}),
    ...(i.phone !== undefined ? { phone: i.phone } : {}), ...(i.creditDays !== undefined ? { creditDays: i.creditDays } : {}),
    ...(i.creditLimitMinor !== undefined ? { creditLimitMinor: i.creditLimitMinor } : {}), ...(i.isActive !== undefined ? { isActive: i.isActive } : {}),
    updatedBy: meta.actorId, updatedAt: new Date(), version: sql`${arCustomers.version} + 1`,
  }).where(and(eq(arCustomers.tenantId, meta.tenantId), eq(arCustomers.id, id))).returning();
  await auditEvent(tx, meta, "update_customer", "ar_customer", id, {});
  return row;
}

export async function getCustomerTx(tx: Tx, tenantId: string, id: string): Promise<ArCustomerRow> {
  const [r] = await tx.select().from(arCustomers).where(and(eq(arCustomers.tenantId, tenantId), eq(arCustomers.id, id))).limit(1);
  if (!r) throw new DomainError("CUSTOMER_NOT_FOUND", `customer ${id} does not exist`);
  return r;
}

export async function listCustomersTx(tx: Tx, tenantId: string): Promise<ArCustomerRow[]> {
  return tx.select().from(arCustomers).where(eq(arCustomers.tenantId, tenantId)).orderBy(asc(arCustomers.customerCode));
}

// ---- rate / HSN resolution (effective-dated masters) ---------------------------------------------------------------------------

/** The rate-master row in force on `onDate` for this rate (most specific HSN prefix first). Null when none is in force. */
async function rateMasterIdTx(tx: Tx, ratePct: string, hsn: string | null, onDate: string): Promise<string | null> {
  const r = rowsOf(await tx.execute(sql`
    SELECT id FROM gl.finance_gst_rate_master
     WHERE rate_pct = ${ratePct}::numeric AND effective_from <= ${onDate}::date AND (effective_to IS NULL OR effective_to >= ${onDate}::date)
       AND (hsn_prefix = '' OR (${hsn}::text IS NOT NULL AND ${hsn}::text LIKE hsn_prefix || '%'))
     ORDER BY length(hsn_prefix) DESC, effective_from DESC LIMIT 1`))[0];
  return (r?.id as string | undefined) ?? null;
}

async function hsnDefaultRateTx(tx: Tx, hsn: string): Promise<string | null> {
  const r = rowsOf(await tx.execute(sql`SELECT default_rate_pct, is_active FROM gl.finance_hsn_sac_master WHERE code = ${hsn} LIMIT 1`))[0];
  if (!r) throw new DomainError("INVOICE_HSN", `HSN/SAC ${hsn} is not in the master`);
  if (r.is_active === false) throw new DomainError("INVOICE_HSN", `HSN/SAC ${hsn} is no longer active`);
  return r.default_rate_pct === null || r.default_rate_pct === undefined ? null : String(r.default_rate_pct);
}

// ---- sales invoice: draft -------------------------------------------------------------------------------------------------------

export type InvoiceLineInput = {
  description: string; hsnSac?: string | undefined; qty: string | number; uom?: string | undefined;
  rateMinor: bigint; discountMinor?: bigint | undefined; gstRatePct?: string | number | undefined;
};
export type InvoiceInput = {
  customerId: string; invoiceDate: string; supplyDate?: string | undefined; dueDate?: string | undefined; placeOfSupply?: string | undefined;
  reverseCharge?: boolean | undefined; narration?: string | undefined; lines: InvoiceLineInput[];
  source?: "api" | "mobile" | undefined; clientRef?: string | undefined;
};

const addDays = (iso: string, days: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function buildInvoiceRowsTx(tx: Tx, tenantId: string, input: InvoiceInput) {
  if (!ISO.test(input.invoiceDate)) throw new DomainError("INVOICE_DATE", "invoice date must be YYYY-MM-DD");
  const customer = await getCustomerTx(tx, tenantId, input.customerId);
  if (!customer.isActive) throw new DomainError("CUSTOMER_INACTIVE", `customer ${customer.customerCode} is inactive`);
  const biz = await loadBusinessTx(tx, tenantId);
  const supplyDate = input.supplyDate ?? input.invoiceDate;
  const dueDate = input.dueDate ?? addDays(input.invoiceDate, customer.creditDays);
  const placeOfSupply = input.placeOfSupply ?? customer.stateCode;
  await assertStateCodeTx(tx, placeOfSupply);
  const timeOfSupply = supplyDate < input.invoiceDate ? supplyDate : input.invoiceDate;

  // rate per line: explicit, else the HSN's indicative default; both must exist in the effective-dated rate master on the supply date
  const lineInputs: LineInput[] = [];
  const masterIds: Array<string | null> = [];
  for (const l of input.lines) {
    let rate: string | number | null = biz.gstRegistered ? (l.gstRatePct ?? null) : 0;
    if (rate === null && l.hsnSac) rate = await hsnDefaultRateTx(tx, l.hsnSac);
    else if (l.hsnSac) await hsnDefaultRateTx(tx, l.hsnSac); // existence / active check
    if (rate === null) throw new DomainError("INVOICE_RATE", `line '${l.description}': give a GST rate or an HSN/SAC with a default rate`);
    lineInputs.push({ qty: l.qty, rateMinor: l.rateMinor, discountMinor: l.discountMinor ?? 0n, gstRatePct: rate });
  }
  const totals = computeInvoice(lineInputs, { gstRegistered: biz.gstRegistered, supplierGstin: biz.gstin, placeOfSupply, customerGstin: customer.gstin });
  for (let i = 0; i < input.lines.length; i++) {
    const ratePct = totals.lines[i]!.ratePct;
    if (!biz.gstRegistered) { masterIds.push(null); continue; }
    const id = await rateMasterIdTx(tx, ratePct, input.lines[i]!.hsnSac ?? null, supplyDate);
    if (!id) throw new DomainError("INVOICE_RATE_NOT_EFFECTIVE", `GST rate ${ratePct}% is not in force on ${supplyDate} (rate master)`);
    masterIds.push(id);
  }
  return { customer, biz, totals, masterIds, supplyDate, dueDate, placeOfSupply, timeOfSupply };
}

export async function createDraftInvoiceTx(tx: Tx, meta: ActorMeta, input: InvoiceInput): Promise<SalesInvoiceRow & { lines: SalesInvoiceLineRow[] }> {
  if (input.clientRef) {
    const [dup] = await tx.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, meta.tenantId), eq(salesInvoices.clientRef, input.clientRef))).limit(1);
    if (dup) return { ...dup, lines: await linesOfTx(tx, meta.tenantId, dup.id) };
  }
  const b = await buildInvoiceRowsTx(tx, meta.tenantId, input);
  const [row] = await tx.insert(salesInvoices).values({
    tenantId: meta.tenantId, customerId: b.customer.id, customerName: b.customer.name, customerGstin: b.customer.gstin, supplierGstin: b.biz.gstRegistered ? b.biz.gstin : null,
    invoiceDate: input.invoiceDate, supplyDate: b.supplyDate, timeOfSupply: b.timeOfSupply, dueDate: b.dueDate, placeOfSupply: b.placeOfSupply,
    supplyType: b.totals.supplyType, invoiceType: b.customer.gstin ? "B2B" : "B2C", reverseCharge: input.reverseCharge ?? false,
    taxableMinor: b.totals.taxableMinor, cgstMinor: b.totals.cgstMinor, sgstMinor: b.totals.sgstMinor, igstMinor: b.totals.igstMinor, cessMinor: 0n,
    taxMinor: b.totals.taxMinor, totalMinor: b.totals.totalMinor, narration: input.narration ?? null,
    source: input.source ?? "api", clientRef: input.clientRef ?? null, createdBy: meta.actorId, updatedBy: meta.actorId,
  }).returning();
  const lines = await insertLinesTx(tx, meta.tenantId, row.id, input, b);
  await auditEvent(tx, meta, "create_sales_invoice_draft", "sales_invoice", row.id, { totalMinor: row.totalMinor.toString(), supplyType: row.supplyType });
  return { ...row, lines };
}

async function insertLinesTx(tx: Tx, tenantId: string, invoiceId: string, input: InvoiceInput, b: Awaited<ReturnType<typeof buildInvoiceRowsTx>>): Promise<SalesInvoiceLineRow[]> {
  return tx.insert(salesInvoiceLines).values(input.lines.map((l, i) => ({
    tenantId, invoiceId, lineNo: i + 1, description: l.description, hsnSac: l.hsnSac ?? null, qty: String(l.qty), uom: l.uom ?? null,
    rateMinor: l.rateMinor, discountMinor: l.discountMinor ?? 0n, taxableMinor: b.totals.lines[i]!.taxableMinor,
    gstRatePct: b.totals.lines[i]!.ratePct, gstRateMasterId: b.masterIds[i] ?? null, taxMinor: b.totals.lines[i]!.taxMinor, totalMinor: b.totals.lines[i]!.totalMinor,
  }))).returning();
}

async function linesOfTx(tx: Tx, tenantId: string, invoiceId: string): Promise<SalesInvoiceLineRow[]> {
  return tx.select().from(salesInvoiceLines).where(and(eq(salesInvoiceLines.tenantId, tenantId), eq(salesInvoiceLines.invoiceId, invoiceId))).orderBy(asc(salesInvoiceLines.lineNo));
}

async function lockInvoiceTx(tx: Tx, tenantId: string, id: string): Promise<SalesInvoiceRow> {
  const [r] = await tx.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, id))).for("update").limit(1);
  if (!r) throw new DomainError("INVOICE_NOT_FOUND", `invoice ${id} does not exist`);
  return r;
}

export async function replaceDraftInvoiceTx(tx: Tx, meta: ActorMeta, id: string, input: InvoiceInput): Promise<SalesInvoiceRow & { lines: SalesInvoiceLineRow[] }> {
  const cur = await lockInvoiceTx(tx, meta.tenantId, id);
  if (cur.status !== "draft") throw new DomainError("INVOICE_NOT_DRAFT", `invoice ${cur.invoiceNo ?? id} is ${cur.status} and can no longer be edited; issue a credit or debit note`);
  const b = await buildInvoiceRowsTx(tx, meta.tenantId, input);
  await tx.delete(salesInvoiceLines).where(and(eq(salesInvoiceLines.tenantId, meta.tenantId), eq(salesInvoiceLines.invoiceId, id)));
  const [row] = await tx.update(salesInvoices).set({
    customerId: b.customer.id, customerName: b.customer.name, customerGstin: b.customer.gstin, supplierGstin: b.biz.gstRegistered ? b.biz.gstin : null,
    invoiceDate: input.invoiceDate, supplyDate: b.supplyDate, timeOfSupply: b.timeOfSupply, dueDate: b.dueDate, placeOfSupply: b.placeOfSupply,
    supplyType: b.totals.supplyType, invoiceType: b.customer.gstin ? "B2B" : "B2C", reverseCharge: input.reverseCharge ?? false,
    taxableMinor: b.totals.taxableMinor, cgstMinor: b.totals.cgstMinor, sgstMinor: b.totals.sgstMinor, igstMinor: b.totals.igstMinor,
    taxMinor: b.totals.taxMinor, totalMinor: b.totals.totalMinor, narration: input.narration ?? null,
    updatedBy: meta.actorId, updatedAt: new Date(), version: sql`${salesInvoices.version} + 1`,
  }).where(and(eq(salesInvoices.tenantId, meta.tenantId), eq(salesInvoices.id, id))).returning();
  const lines = await insertLinesTx(tx, meta.tenantId, id, input, b);
  return { ...row, lines };
}

export async function deleteDraftInvoiceTx(tx: Tx, meta: ActorMeta, id: string): Promise<void> {
  const cur = await lockInvoiceTx(tx, meta.tenantId, id);
  if (cur.status !== "draft") throw new DomainError("INVOICE_NOT_DRAFT", `invoice ${cur.invoiceNo ?? id} is ${cur.status} and can no longer be deleted`);
  await tx.delete(salesInvoiceLines).where(and(eq(salesInvoiceLines.tenantId, meta.tenantId), eq(salesInvoiceLines.invoiceId, id)));
  await tx.delete(salesInvoices).where(and(eq(salesInvoices.tenantId, meta.tenantId), eq(salesInvoices.id, id)));
}

export async function getInvoiceTx(tx: Tx, tenantId: string, id: string): Promise<SalesInvoiceRow & { lines: SalesInvoiceLineRow[] }> {
  const [r] = await tx.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, id))).limit(1);
  if (!r) throw new DomainError("INVOICE_NOT_FOUND", `invoice ${id} does not exist`);
  return { ...r, lines: await linesOfTx(tx, tenantId, id) };
}

export async function listInvoicesTx(tx: Tx, tenantId: string, f: { status?: "draft" | "issued" | undefined; customerId?: string | undefined } = {}): Promise<SalesInvoiceRow[]> {
  const conds = [eq(salesInvoices.tenantId, tenantId), ...(f.status ? [eq(salesInvoices.status, f.status)] : []), ...(f.customerId ? [eq(salesInvoices.customerId, f.customerId)] : [])];
  return tx.select().from(salesInvoices).where(and(...conds)).orderBy(asc(salesInvoices.invoiceDate), asc(salesInvoices.createdAt));
}

// ---- posting guards --------------------------------------------------------------------------------------------------------------

/** Refuse, with a 422, a posting the GL consumer could never post (closed / unknown period, draft or closed FY): same rules, accept-time. */
async function assertPostingAllowedTx(tx: Tx, tenantId: string, postingDate: string, coaTemplate: string): Promise<void> {
  if (coaTemplate === "commercial") await assertCommercialChartReadyTx(tx, tenantId);
  const period = postingDate.slice(0, 7);
  const refusal = periodPostingRefusal(await getPeriodStatusTx(tx, tenantId, period), "journal", period);
  if (refusal) throw new DomainError(refusal.code, refusal.message);
  const fyCode = fyFromDate(postingDate);
  const fy = rowsOf(await tx.execute(sql`SELECT status FROM gl.finance_fiscal_years WHERE tenant_id = ${tenantId}::uuid AND code = ${fyCode} LIMIT 1`))[0];
  if (fy?.status === "draft") throw new DomainError("FY_NOT_ACTIVE", `financial year ${fyCode} has not been activated; postings dated ${postingDate} cannot be accepted until it is`);
  const closed = await fyClosedReasonTx(tx, tenantId, fyCode);
  if (closed) throw new DomainError("FY_CLOSED", fyClosedMessage(closed, postingDate));
}

async function nextDocNoTx(tx: Tx, tenantId: string, docType: DocType, dateIso: string): Promise<string> {
  const at = mintInstant(dateIso);
  const out = await allocateReference(tx, { spec: specFor(docType), seqConfig: AR_SEQ_CONFIG, formatKey: docType, tenantId, at, segments: [fySegment(at)] });
  assertRule46(out.reference);
  return out.reference;
}

/** Dr/Cr on the AR control and sales revenue heads for `amount` (taxable value). debitAr = true for an invoice / debit note. */
function salesJournal(debitAr: boolean, taxable: bigint, tax: bigint, narration: string) {
  const ar = { accountCode: AR_CONTROL_CODE(), debitMinor: debitAr ? taxable + tax : 0n, creditMinor: debitAr ? 0n : taxable + tax, narration };
  const rev = { accountCode: SALES_REVENUE_CODE(), debitMinor: debitAr ? 0n : taxable, creditMinor: debitAr ? taxable : 0n, narration };
  const gst = { accountCode: GST_PAYABLE_CODE, debitMinor: debitAr ? 0n : tax, creditMinor: debitAr ? tax : 0n, narration };
  const taxLeg = tax > 0n ? [gst] : [];
  return debitAr ? [ar, rev, ...taxLeg] : [rev, ...taxLeg, ar];
}

// ---- output GST rows (M3b) ----------------------------------------------------------------------------------------------------------

type RateGroup = { ratePct: number; taxableMinor: bigint; taxMinor: bigint };
/** Invoice lines grouped by GST rate (the gst ledger keeps one row per tax type and rate per source document). */
function rateGroups(lines: SalesInvoiceLineRow[]): RateGroup[] {
  const m = new Map<number, RateGroup>();
  for (const l of lines) {
    const r = Number(l.gstRatePct);
    const g = m.get(r) ?? { ratePct: r, taxableMinor: 0n, taxMinor: 0n };
    g.taxableMinor += l.taxableMinor; g.taxMinor += l.taxMinor; m.set(r, g);
  }
  return [...m.values()].filter((g) => g.taxMinor > 0n);
}

/**
 * The output gst-ledger entries of a document, summing EXACTLY to its stored CGST / SGST / IGST (`want`): each rate group is split on
 * its own, then any rounding residual against the document-level split is carried by the largest group. CGST / SGST rows use half the
 * slab rate (the consumer validates them against half a slab); IGST the full rate. `sign` -1 makes a credit note's rows negative.
 */
function outputEntries(supply: SupplyType, groups: RateGroup[], want: { cgstMinor: bigint; sgstMinor: bigint; igstMinor: bigint }, sign: 1n | -1n): GstLedgerEntry[] {
  if (supply === "none" || groups.length === 0) return [];
  const big = groups.reduce((bi, g, i) => (g.taxMinor > groups[bi]!.taxMinor ? i : bi), 0);
  const intra = supply === "intra";
  const per = groups.map((g) => (intra ? splitIntraStateTax(g.taxMinor) : { cgstMinor: 0n, sgstMinor: 0n }));
  const igst = groups.map((g) => (intra ? 0n : g.taxMinor));
  const fix = (arr: bigint[], target: bigint): void => { arr[big] = arr[big]! + (target - arr.reduce((a, b) => a + b, 0n)); };
  const cg = per.map((p) => p.cgstMinor); const sg = per.map((p) => p.sgstMinor);
  fix(cg, intra ? want.cgstMinor : 0n); fix(sg, intra ? want.sgstMinor : 0n); fix(igst, intra ? 0n : want.igstMinor);
  const out: GstLedgerEntry[] = [];
  const push = (gstType: "CGST" | "SGST" | "IGST", ratePct: number, g: RateGroup, tax: bigint): void => {
    if (tax === 0n) return;
    out.push({ gstType, ratePct, taxableMinor: (g.taxableMinor * sign).toString(), taxMinor: (tax * sign).toString(), rcm: false, glHeadCode: GST_PAYABLE_CODE });
  };
  groups.forEach((g, i) => {
    push("CGST", g.ratePct / 2, g, cg[i]!); push("SGST", g.ratePct / 2, g, sg[i]!); push("IGST", g.ratePct, g, igst[i]!);
  });
  return out;
}

function outputGstMeta(sourceDocType: string, sourceDocId: string, invoiceNo: string, invoiceDate: string, partyGstin: string | null, partyName: string, entries: GstLedgerEntry[]): GstJournalMeta {
  return { sourceDocType, sourceDocId, invoiceNo, invoiceDate, partyGstin, partyName, direction: "output", entries };
}

// ---- advance receipts (Rule 50) -----------------------------------------------------------------------------------------------------

export type AdvanceInput = { customerId: string; receiptDate: string; amountMinor: bigint; gstRatePct?: string | number | undefined; placeOfSupply?: string | undefined; paymentMode?: string | undefined; reference?: string | undefined };

/** Tax-inclusive advance: taxable = amount * 100 / (100 + rate), rounded half-up; tax = amount - taxable. */
export async function createAdvanceReceiptTx(tx: Tx, meta: ActorMeta, i: AdvanceInput): Promise<AdvanceReceiptRow> {
  if (!ISO.test(i.receiptDate)) throw new DomainError("ADVANCE_DATE", "receipt date must be YYYY-MM-DD");
  if (i.amountMinor <= 0n) throw new DomainError("ADVANCE_AMOUNT", "an advance must be greater than zero");
  const customer = await getCustomerTx(tx, meta.tenantId, i.customerId);
  const biz = await loadBusinessTx(tx, meta.tenantId);
  const placeOfSupply = i.placeOfSupply ?? customer.stateCode;
  await assertStateCodeTx(tx, placeOfSupply);
  const hundredths = biz.gstRegistered ? BigInt(Math.round(Number(i.gstRatePct ?? 0) * 100)) : 0n;
  const taxable = hundredths === 0n ? i.amountMinor : (i.amountMinor * 10000n * 2n + (10000n + hundredths)) / ((10000n + hundredths) * 2n);
  const tax = i.amountMinor - taxable;
  const split = splitTax(tax, { gstRegistered: biz.gstRegistered, supplierGstin: biz.gstin, placeOfSupply, customerGstin: customer.gstin });
  const receiptNo = await nextDocNoTx(tx, meta.tenantId, "advance_receipt", i.receiptDate);
  const [row] = await tx.insert(advanceReceipts).values({
    tenantId: meta.tenantId, receiptNo, customerId: customer.id, receiptDate: i.receiptDate, placeOfSupply, supplyType: split.supplyType, amountMinor: i.amountMinor,
    gstRatePct: String(Number(hundredths) / 100), taxableMinor: taxable, cgstMinor: split.cgstMinor, sgstMinor: split.sgstMinor, igstMinor: split.igstMinor, taxMinor: tax,
    paymentMode: i.paymentMode ?? null, reference: i.reference ?? null, createdBy: meta.actorId, updatedBy: meta.actorId,
  }).returning();
  await auditEvent(tx, meta, "create_advance_receipt", "advance_receipt", row.id, { receiptNo, amountMinor: i.amountMinor.toString() });
  return row;
}

export async function listAdvanceReceiptsTx(tx: Tx, tenantId: string, customerId?: string): Promise<AdvanceReceiptRow[]> {
  return tx.select().from(advanceReceipts).where(and(eq(advanceReceipts.tenantId, tenantId), ...(customerId ? [eq(advanceReceipts.customerId, customerId)] : []))).orderBy(asc(advanceReceipts.receiptNo));
}

// ---- sales invoice: issue ----------------------------------------------------------------------------------------------------------------

/**
 * Draft -> issued, in ONE transaction: gapless Rule-46 number, advance receipts adjusted, AR sub-ledger entries, and the
 * Dr AR / Cr revenue journal enqueued on the outbox (same tx). A refusal anywhere rolls the number back with it (no gap).
 */
export async function issueInvoiceTx(tx: Tx, meta: ActorMeta, id: string, opts: { advanceReceiptIds?: string[] | undefined } = {}): Promise<SalesInvoiceRow & { lines: SalesInvoiceLineRow[] }> {
  const inv = await lockInvoiceTx(tx, meta.tenantId, id);
  if (inv.status !== "draft") throw new DomainError("INVOICE_NOT_DRAFT", `invoice ${inv.invoiceNo ?? id} is already ${inv.status}`);
  const biz = await loadBusinessTx(tx, meta.tenantId);
  const lines = await linesOfTx(tx, meta.tenantId, id);
  if (lines.length === 0) throw new DomainError("INVOICE_NO_LINES", "an invoice needs at least one line");
  if (inv.totalMinor <= 0n) throw new DomainError("INVOICE_ZERO", "an invoice of zero value cannot be issued");
  if (biz.gstRegistered && lines.some((l) => !l.hsnSac)) throw new DomainError("INVOICE_HSN_REQUIRED", "every line of a GST invoice needs its HSN/SAC code");
  const ps = await loadPostingSettingsTx(tx, meta.tenantId);
  await assertPostingAllowedTx(tx, meta.tenantId, inv.invoiceDate, ps.coaTemplate);
  // M3b gate (same as M3a): GST rows / the output line exist only for a registered tenant on a non-govt chart.
  const gstOn = biz.gstRegistered && ps.coaTemplate !== "govt";
  if (inv.taxMinor > 0n && !gstOn) throw new DomainError("INVOICE_GST_NOT_REGISTERED", "this invoice carries GST but the business is not GST-registered on a commercial chart");

  // advances: whole receipts of this customer, adjusted up to the invoice total
  let advance = 0n;
  let timeOfSupply = inv.timeOfSupply;
  const adv: AdvanceReceiptRow[] = [];
  if (opts.advanceReceiptIds?.length) {
    const found: AdvanceReceiptRow[] = await tx.select().from(advanceReceipts)
      .where(and(eq(advanceReceipts.tenantId, meta.tenantId), inArray(advanceReceipts.id, opts.advanceReceiptIds))).for("update");
    if (found.length !== new Set(opts.advanceReceiptIds).size) throw new DomainError("ADVANCE_NOT_FOUND", "an advance receipt does not exist");
    for (const a of found) {
      if (a.customerId !== inv.customerId) throw new DomainError("ADVANCE_CUSTOMER", `advance ${a.receiptNo} belongs to another customer`);
      if (a.status !== "open") throw new DomainError("ADVANCE_USED", `advance ${a.receiptNo} is already adjusted`);
      advance += a.amountMinor;
      if (a.receiptDate < timeOfSupply) timeOfSupply = a.receiptDate; // time of supply for the advance-covered part: the receipt date (VERIFY-by-CA)
      adv.push(a);
    }
    if (advance > inv.totalMinor) throw new DomainError("ADVANCE_EXCEEDS", `advances of ${advance} paise exceed the invoice total ${inv.totalMinor} paise`);
  }

  const invoiceNo = await nextDocNoTx(tx, meta.tenantId, "sales_invoice", inv.invoiceDate);
  const journalId = deterministicId(`sales_invoice:${id}`);
  const [row] = await tx.update(salesInvoices).set({
    status: "issued", invoiceNo, journalId, issuedAt: new Date(), issuedBy: meta.actorId, advanceAdjustedMinor: advance, timeOfSupply,
    updatedBy: meta.actorId, updatedAt: new Date(), version: sql`${salesInvoices.version} + 1`,
  }).where(and(eq(salesInvoices.tenantId, meta.tenantId), eq(salesInvoices.id, id))).returning();

  await tx.insert(arLedgerEntries).values({
    tenantId: meta.tenantId, customerId: inv.customerId, invoiceId: id, entryType: "invoice", sourceDocId: id, sourceDocNo: invoiceNo,
    entryDate: inv.invoiceDate, dueDate: inv.dueDate, debitMinor: inv.totalMinor, creditMinor: 0n, journalId, createdBy: meta.actorId,
  });
  if (advance > 0n) {
    for (const a of adv) await tx.update(advanceReceipts).set({ status: "adjusted", adjustedInvoiceId: id, updatedBy: meta.actorId, updatedAt: new Date() })
      .where(and(eq(advanceReceipts.tenantId, meta.tenantId), eq(advanceReceipts.id, a.id)));
    await tx.insert(arLedgerEntries).values({
      tenantId: meta.tenantId, customerId: inv.customerId, invoiceId: id, entryType: "advance_adjustment", sourceDocId: id, sourceDocNo: invoiceNo,
      entryDate: inv.invoiceDate, dueDate: inv.dueDate, debitMinor: 0n, creditMinor: advance, journalId: null, createdBy: meta.actorId,
    });
  }
  // Dr AR (total) / Cr revenue (taxable) / Cr GST Payable (tax) + the output gst-ledger rows, in the one posting tx (see the file header).
  await enqueueSpineJournal(tx, {
    tenantId: meta.tenantId, actorId: meta.actorId, correlationId: meta.correlationId, sourceKey: `sales_invoice:${id}`, type: "journal",
    postingDate: inv.invoiceDate, lines: salesJournal(true, inv.taxableMinor, inv.taxMinor, `Sales invoice ${invoiceNo} - ${inv.customerName}`),
    ...(inv.taxMinor > 0n ? { extra: { gst: outputGstMeta("sales_invoice", id, invoiceNo, inv.invoiceDate, inv.customerGstin, inv.customerName, outputEntries(inv.supplyType, rateGroups(lines), inv, 1n)) } } : {}),
  });
  await auditEvent(tx, meta, "issue_sales_invoice", "sales_invoice", id, { invoiceNo, totalMinor: inv.totalMinor.toString(), taxMinor: inv.taxMinor.toString(), journalId });
  return { ...row, lines };
}

// ---- credit / debit notes ----------------------------------------------------------------------------------------------------------------

export type NoteInput = { invoiceId: string; noteType: NoteType; noteDate: string; reason: NoteReason; reasonText?: string | undefined; taxableMinor: bigint; gstRatePct?: string | number | undefined };

export async function createNoteTx(tx: Tx, meta: ActorMeta, i: NoteInput): Promise<CreditDebitNoteRow> {
  if (!ISO.test(i.noteDate)) throw new DomainError("NOTE_DATE", "note date must be YYYY-MM-DD");
  const inv = await lockInvoiceTx(tx, meta.tenantId, i.invoiceId);
  if (inv.status !== "issued") throw new DomainError("NOTE_INVOICE_NOT_ISSUED", "a credit or debit note can only refer to an issued invoice");
  if (i.noteDate < inv.invoiceDate) throw new DomainError("NOTE_DATE", "a note cannot be dated before its invoice");
  let rate = i.gstRatePct;
  if (rate === undefined) {
    const lines = await linesOfTx(tx, meta.tenantId, inv.id);
    const rates = new Set(lines.map((l) => String(l.gstRatePct)));
    if (inv.supplyType === "none") rate = 0;
    else if (rates.size === 1) rate = [...rates][0]!;
    else throw new DomainError("NOTE_RATE", "the invoice has more than one GST rate: state the rate of this note");
  }
  const n = computeNote(i.taxableMinor, rate, inv.supplyType, inv.supplierGstin, inv.placeOfSupply, inv.customerGstin);
  if (i.noteType === "credit") {
    const prior = rowsOf(await tx.execute(sql`
      SELECT COALESCE(SUM(taxable_minor), 0)::text AS taxable, COALESCE(SUM(tax_minor), 0)::text AS tax
        FROM ar.credit_debit_notes WHERE tenant_id = ${meta.tenantId}::uuid AND invoice_id = ${inv.id}::uuid AND note_type = 'credit'`))[0]!;
    if (BigInt(prior.taxable as string) + n.taxableMinor > inv.taxableMinor) throw new DomainError("NOTE_EXCEEDS_INVOICE", "credit notes would exceed the taxable value of the invoice");
    if (BigInt(prior.tax as string) + n.taxMinor > inv.taxMinor) throw new DomainError("NOTE_EXCEEDS_INVOICE", "credit notes would exceed the tax of the invoice");
  }
  const [row] = await tx.insert(creditDebitNotes).values({
    tenantId: meta.tenantId, noteType: i.noteType, invoiceId: inv.id, customerId: inv.customerId, noteDate: i.noteDate, reason: i.reason, reasonText: i.reasonText ?? null,
    gstRatePct: inv.supplyType === "none" ? null : String(rate), supplyType: n.supplyType, taxableMinor: n.taxableMinor, cgstMinor: n.cgstMinor, sgstMinor: n.sgstMinor, igstMinor: n.igstMinor, cessMinor: 0n,
    taxMinor: n.taxMinor, totalMinor: n.totalMinor, s34CutoffDate: s34Cutoff(inv.invoiceDate), withinS34Window: withinS34(inv.invoiceDate, i.noteDate),
    createdBy: meta.actorId, updatedBy: meta.actorId,
  }).returning();
  await auditEvent(tx, meta, "create_note_draft", "credit_debit_note", row.id, { invoiceId: inv.id, noteType: i.noteType });
  return row;
}

export async function issueNoteTx(tx: Tx, meta: ActorMeta, id: string): Promise<CreditDebitNoteRow> {
  const [n]: CreditDebitNoteRow[] = await tx.select().from(creditDebitNotes).where(and(eq(creditDebitNotes.tenantId, meta.tenantId), eq(creditDebitNotes.id, id))).for("update").limit(1);
  if (!n) throw new DomainError("NOTE_NOT_FOUND", `note ${id} does not exist`);
  if (n.status !== "draft") throw new DomainError("NOTE_NOT_DRAFT", `note ${n.noteNo ?? id} is already issued`);
  const inv = await lockInvoiceTx(tx, meta.tenantId, n.invoiceId);
  const ps = await loadPostingSettingsTx(tx, meta.tenantId);
  await assertPostingAllowedTx(tx, meta.tenantId, n.noteDate, ps.coaTemplate);
  const biz = await loadBusinessTx(tx, meta.tenantId);
  const gstOn = biz.gstRegistered && ps.coaTemplate !== "govt";
  if (n.taxMinor > 0n && !gstOn) throw new DomainError("NOTE_GST_NOT_REGISTERED", "this note carries GST but the business is not GST-registered on a commercial chart");
  if (n.taxMinor > 0n && n.gstRatePct == null) throw new DomainError("NOTE_RATE", "the note has tax but no stored GST rate");
  const docType: DocType = n.noteType === "credit" ? "credit_note" : "debit_note";
  const noteNo = await nextDocNoTx(tx, meta.tenantId, docType, n.noteDate);
  const journalId = deterministicId(`${docType}:${id}`);
  const [row] = await tx.update(creditDebitNotes).set({
    status: "issued", noteNo, journalId, issuedAt: new Date(), issuedBy: meta.actorId, updatedBy: meta.actorId, updatedAt: new Date(), version: sql`${creditDebitNotes.version} + 1`,
  }).where(and(eq(creditDebitNotes.tenantId, meta.tenantId), eq(creditDebitNotes.id, id))).returning();
  const credit = n.noteType === "credit";
  await tx.insert(arLedgerEntries).values({
    tenantId: meta.tenantId, customerId: n.customerId, invoiceId: n.invoiceId, entryType: credit ? "credit_note" : "debit_note", sourceDocId: id, sourceDocNo: noteNo,
    entryDate: n.noteDate, dueDate: inv.dueDate, debitMinor: credit ? 0n : n.totalMinor, creditMinor: credit ? n.totalMinor : 0n, journalId, createdBy: meta.actorId,
  });
  // credit note: Dr revenue + Dr GST Payable / Cr AR (s.34 reduces output tax); debit note: Dr AR / Cr revenue + Cr GST Payable.
  await enqueueSpineJournal(tx, {
    tenantId: meta.tenantId, actorId: meta.actorId, correlationId: meta.correlationId, sourceKey: `${docType}:${id}`, type: "journal",
    postingDate: n.noteDate, lines: salesJournal(!credit, n.taxableMinor, n.taxMinor, `${credit ? "Credit" : "Debit"} note ${noteNo} against ${inv.invoiceNo}`),
    ...(n.taxMinor > 0n ? { extra: { gst: outputGstMeta(docType, id, noteNo, n.noteDate, inv.customerGstin, inv.customerName,
      outputEntries(n.supplyType, [{ ratePct: Number(n.gstRatePct), taxableMinor: n.taxableMinor, taxMinor: n.taxMinor }], n, credit ? -1n : 1n)) } } : {}),
  });
  await auditEvent(tx, meta, "issue_note", "credit_debit_note", id, { noteNo, noteType: n.noteType, withinS34Window: n.withinS34Window });
  return row;
}

export async function listNotesTx(tx: Tx, tenantId: string, invoiceId?: string): Promise<CreditDebitNoteRow[]> {
  return tx.select().from(creditDebitNotes).where(and(eq(creditDebitNotes.tenantId, tenantId), ...(invoiceId ? [eq(creditDebitNotes.invoiceId, invoiceId)] : []))).orderBy(asc(creditDebitNotes.createdAt));
}

// ---- AR sub-ledger + ageing --------------------------------------------------------------------------------------------------------------

export type AgeingRow = { customerId: string; customerCode: string; customerName: string; buckets: Record<AgeingBucket, bigint>; totalMinor: bigint };

/** Open balance per invoice (debits - credits up to asOf), bucketed by days past the invoice due date. Settled invoices drop out. */
export async function arAgeingTx(tx: Tx, tenantId: string, asOf: string): Promise<{ asOf: string; rows: AgeingRow[]; totals: Record<AgeingBucket, bigint>; totalMinor: bigint }> {
  if (!ISO.test(asOf)) throw new DomainError("AGEING_DATE", "asOf must be YYYY-MM-DD");
  const open = rowsOf(await tx.execute(sql`
    SELECT e.customer_id, c.customer_code, c.name, e.invoice_id, MAX(e.due_date)::text AS due_date,
           SUM(e.debit_minor - e.credit_minor)::text AS balance
      FROM ar.ledger_entries e JOIN ar.customers c ON c.tenant_id = e.tenant_id AND c.id = e.customer_id
     WHERE e.tenant_id = ${tenantId}::uuid AND e.entry_date <= ${asOf}::date
     GROUP BY e.customer_id, c.customer_code, c.name, e.invoice_id
    HAVING SUM(e.debit_minor - e.credit_minor) <> 0
     ORDER BY c.customer_code, e.invoice_id`));
  const zero = (): Record<AgeingBucket, bigint> => Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0n])) as Record<AgeingBucket, bigint>;
  const byCustomer = new Map<string, AgeingRow>();
  const totals = zero();
  let grand = 0n;
  for (const o of open) {
    const bal = BigInt(o.balance as string);
    const bucket = ageingBucket(o.due_date as string, asOf);
    let row = byCustomer.get(o.customer_id as string);
    if (!row) { row = { customerId: o.customer_id as string, customerCode: o.customer_code as string, customerName: o.name as string, buckets: zero(), totalMinor: 0n }; byCustomer.set(row.customerId, row); }
    row.buckets[bucket] += bal; row.totalMinor += bal; totals[bucket] += bal; grand += bal;
  }
  return { asOf, rows: [...byCustomer.values()], totals, totalMinor: grand };
}

export async function customerLedgerTx(tx: Tx, tenantId: string, customerId: string) {
  await getCustomerTx(tx, tenantId, customerId);
  return tx.select().from(arLedgerEntries).where(and(eq(arLedgerEntries.tenantId, tenantId), eq(arLedgerEntries.customerId, customerId))).orderBy(asc(arLedgerEntries.entryDate), asc(arLedgerEntries.createdAt));
}

// ---- mobile sync ---------------------------------------------------------------------------------------------------------------------

export type MobileInvoice = {
  id: string; customerId?: string | undefined; customerName: string; dueDate?: string | undefined; placeOfSupply?: string | undefined;
  createdAt?: string | undefined; items: Array<{ name: string; qty: number; rate: number; gstPercent: number }>;
};

/**
 * The mobile app's offline invoice (apps/mobile invoice_model.dart: items{name,qty,rate paise,gstPercent}). Idempotent on the client
 * id (client_ref): a retry returns the same draft. It lands as a DRAFT: the mobile form carries no HSN/SAC and no GST state, so the
 * invoice is completed and issued from the web app (issue enforces HSN on every line). A customer the device made up is matched
 * by name, else created (code MOB-xxxxxxxx) in the business's own state; with no GSTIN on file the payload must give placeOfSupply.
 */
export async function syncMobileInvoiceTx(tx: Tx, meta: ActorMeta, m: MobileInvoice): Promise<SalesInvoiceRow & { lines: SalesInvoiceLineRow[] }> {
  const [dup] = await tx.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, meta.tenantId), eq(salesInvoices.clientRef, m.id))).limit(1);
  if (dup) return { ...dup, lines: await linesOfTx(tx, meta.tenantId, dup.id) };
  let customer: ArCustomerRow | undefined;
  if (m.customerId) customer = (await tx.select().from(arCustomers).where(and(eq(arCustomers.tenantId, meta.tenantId), eq(arCustomers.id, m.customerId))).limit(1))[0];
  if (!customer) {
    const hit = rowsOf(await tx.execute(sql`SELECT id FROM ar.customers WHERE tenant_id = ${meta.tenantId}::uuid AND lower(name) = lower(${m.customerName.trim()}) LIMIT 1`))[0];
    if (hit) customer = await getCustomerTx(tx, meta.tenantId, hit.id as string);
  }
  if (!customer) {
    const biz = await loadBusinessTx(tx, meta.tenantId);
    const state = m.placeOfSupply ?? biz.gstin?.slice(0, 2);
    if (!state) throw new DomainError("MOBILE_CUSTOMER_STATE", "the business has no GSTIN on file: send placeOfSupply (GST state code) with the invoice");
    customer = await createCustomerTx(tx, meta, { customerCode: `MOB-${m.id.replace(/-/g, "").slice(0, 8)}`.toUpperCase(), name: m.customerName, stateCode: state });
  }
  const invoiceDate = (m.createdAt ?? new Date().toISOString()).slice(0, 10);
  return createDraftInvoiceTx(tx, meta, {
    customerId: customer.id, invoiceDate, ...(m.dueDate ? { dueDate: m.dueDate.slice(0, 10) } : {}), ...(m.placeOfSupply ? { placeOfSupply: m.placeOfSupply } : {}),
    lines: m.items.map((it) => ({ description: it.name, qty: it.qty, rateMinor: BigInt(it.rate), gstRatePct: it.gstPercent })), source: "mobile", clientRef: m.id,
  });
}
