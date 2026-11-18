/**
 * MSME commercial M4: loads the tenant's own data (ar.sales_invoices + notes + advances, gl.finance_gst_ledger), runs the pure
 * builders, and stores an immutable prepared snapshot. READ-SIDE over the ledger and invoices: it writes only gl.gst_return_*.
 * PREPARE / EXPORT only: nothing here talks to GSTN (live filing is v2).
 */
import { sql } from "drizzle-orm";
import { DomainError } from "../approvals/domain.js";
import { auditEvent, type ActorMeta } from "../approvals/apply.js";
import { GSTR_CONFIG, QUARTER_END_MONTHS, type GstrConfig } from "./config.js";
import { getAdapter } from "./adapters.js";
import {
  buildGstr1, buildGstr3b, reconcile, headsTotal,
  type AdvanceIn, type DocMeta, type InvoiceIn, type LedgerRow, type LineIn, type NoteIn, type HsnMeta, type Gstr1Model,
} from "./domain.js";

type Tx = any;
type Row = Record<string, any>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { rows?: Row[] })?.rows ?? [])) as Row[];
const ser = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x instanceof Map ? Object.fromEntries(x) : x instanceof Set ? [...x] : x));
const big = (v: unknown): bigint => BigInt(String(v ?? 0));
const idList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

export interface PrepareInput { period: string; filedOn?: string | undefined }

const pad = (n: number): string => String(n).padStart(2, "0");
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const fyStartOf = (iso: string): string => { const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7)); return `${m >= 4 ? y : y - 1}-04-01`; };
const addYears = (iso: string, n: number): string => `${Number(iso.slice(0, 4)) + n}${iso.slice(4)}`;
const dayBefore = (iso: string): string => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export function periodRange(period: string, frequency: "monthly" | "quarterly"): { kind: "periodic" | "iff"; from: string; to: string; fp: string; ret: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new DomainError("GSTR_PERIOD", "period must be YYYY-MM");
  const y = Number(period.slice(0, 4)); const m = Number(period.slice(5, 7));
  const quarterEnd = (QUARTER_END_MONTHS as readonly number[]).includes(m);
  const fp = `${pad(m)}${y}`;
  if (frequency === "quarterly" && quarterEnd) return { kind: "periodic", from: `${y}-${pad(m - 2)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}`, fp, ret: fp };
  return { kind: frequency === "quarterly" ? "iff" : "periodic", from: `${period}-01`, to: `${period}-${pad(lastDay(y, m))}`, fp, ret: fp };
}

export async function loadBusinessTx(tx: Tx, tenantId: string): Promise<{ gstRegistered: boolean; gstin: string | null }> {
  const r = rowsOf(await tx.execute(sql`SELECT gst_registered, gstin FROM gl.finance_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1`))[0];
  return { gstRegistered: r?.gst_registered === true, gstin: r?.gstin ?? null };
}

async function turnoverTx(tx: Tx, tenantId: string, from: string, to: string): Promise<bigint> {
  if (to < from) return 0n;
  const r = rowsOf(await tx.execute(sql`SELECT COALESCE(SUM(taxable_minor), 0)::text AS t FROM ar.sales_invoices
    WHERE tenant_id = ${tenantId}::uuid AND status = 'issued' AND invoice_date >= ${from}::date AND invoice_date <= ${to}::date`))[0];
  return big(r?.t);
}

export async function getReturnSettingsTx(tx: Tx, tenantId: string, cfg: GstrConfig = GSTR_CONFIG, today = new Date().toISOString().slice(0, 10)) {
  const r = rowsOf(await tx.execute(sql`SELECT filing_frequency FROM gl.gst_return_settings WHERE tenant_id = ${tenantId}::uuid`))[0];
  const fy = fyStartOf(today); const prevStart = addYears(fy, -1);
  const prev = await turnoverTx(tx, tenantId, prevStart, dayBefore(fy));
  return {
    filingFrequency: (r?.filing_frequency ?? "monthly") as "monthly" | "quarterly",
    qrmp: { previousFyTurnoverMinor: prev, ceilingMinor: cfg.qrmpTurnoverCeilingMinor, eligible: prev <= cfg.qrmpTurnoverCeilingMinor, iffMonthlyCapMinor: cfg.iffMonthlyCapMinor, caVerify: true },
    jsonSchemaVersion: cfg.jsonSchemaVersion, caVerify: true,
  };
}

export async function setFilingFrequencyTx(tx: Tx, meta: ActorMeta, frequency: "monthly" | "quarterly", cfg: GstrConfig = GSTR_CONFIG, today?: string) {
  const biz = await loadBusinessTx(tx, meta.tenantId);
  if (!biz.gstRegistered || !biz.gstin) throw new DomainError("GSTR_NOT_REGISTERED", "this business is not GST-registered");
  if (frequency === "quarterly") {
    const cur = await getReturnSettingsTx(tx, meta.tenantId, cfg, today);
    if (!cur.qrmp.eligible) throw new DomainError("QRMP_NOT_ELIGIBLE", `previous-FY turnover ${cur.qrmp.previousFyTurnoverMinor} paise exceeds the QRMP ceiling ${cfg.qrmpTurnoverCeilingMinor} (CA-VERIFY; PAN-level in law)`);
  }
  await tx.execute(sql`INSERT INTO gl.gst_return_settings (tenant_id, filing_frequency, updated_by) VALUES (${meta.tenantId}::uuid, ${frequency}, ${meta.actorId}::uuid)
    ON CONFLICT (tenant_id) DO UPDATE SET filing_frequency = EXCLUDED.filing_frequency, updated_by = EXCLUDED.updated_by, updated_at = now(), version = gl.gst_return_settings.version + 1`);
  await auditEvent(tx, meta, "set_gst_filing_frequency", "gst_return_settings", meta.tenantId, { frequency });
  return getReturnSettingsTx(tx, meta.tenantId, cfg, today);
}

async function loadInvoicesTx(tx: Tx, tenantId: string, where: ReturnType<typeof sql>): Promise<InvoiceIn[]> {
  const inv = rowsOf(await tx.execute(sql`SELECT id, invoice_no, invoice_date::text AS invoice_date, customer_gstin, place_of_supply, supply_type, reverse_charge,
      taxable_minor::text, cgst_minor::text, sgst_minor::text, igst_minor::text, cess_minor::text, total_minor::text
    FROM ar.sales_invoices WHERE tenant_id = ${tenantId}::uuid AND status = 'issued' AND ${where} ORDER BY invoice_date, invoice_no`));
  if (inv.length === 0) return [];
  const lines = rowsOf(await tx.execute(sql`SELECT invoice_id, description, hsn_sac, qty::text, uom, taxable_minor::text, gst_rate_pct::text, tax_minor::text
    FROM ar.sales_invoice_lines WHERE tenant_id = ${tenantId}::uuid AND invoice_id IN (${idList(inv.map((r) => r.id))}) ORDER BY invoice_id, line_no`));
  const byInv = new Map<string, LineIn[]>();
  for (const l of lines) (byInv.get(l.invoice_id) ?? byInv.set(l.invoice_id, []).get(l.invoice_id)!).push({
    hsnSac: l.hsn_sac ?? null, description: l.description, qty: l.qty, uom: l.uom ?? null, taxableMinor: big(l.taxable_minor), gstRatePct: l.gst_rate_pct, taxMinor: big(l.tax_minor) });
  return inv.map((r) => ({
    id: r.id, invoiceNo: r.invoice_no, invoiceDate: r.invoice_date, customerGstin: r.customer_gstin ?? null, placeOfSupply: r.place_of_supply, supplyType: r.supply_type,
    reverseCharge: r.reverse_charge === true, taxableMinor: big(r.taxable_minor), cgstMinor: big(r.cgst_minor), sgstMinor: big(r.sgst_minor), igstMinor: big(r.igst_minor),
    cessMinor: big(r.cess_minor), totalMinor: big(r.total_minor), lines: byInv.get(r.id) ?? [],
  }));
}

async function loadNotesTx(tx: Tx, tenantId: string, where: ReturnType<typeof sql>): Promise<NoteIn[]> {
  return rowsOf(await tx.execute(sql`SELECT n.id, n.note_no, n.note_type, n.note_date::text AS note_date, n.invoice_id, i.invoice_no, i.invoice_date::text AS invoice_date, i.customer_gstin,
      i.place_of_supply, n.supply_type, n.within_s34_window, i.total_minor::text AS inv_total, n.taxable_minor::text, n.cgst_minor::text, n.sgst_minor::text, n.igst_minor::text, n.cess_minor::text, n.total_minor::text
    FROM ar.credit_debit_notes n JOIN ar.sales_invoices i ON i.tenant_id = n.tenant_id AND i.id = n.invoice_id
    WHERE n.tenant_id = ${tenantId}::uuid AND n.status = 'issued' AND ${where} ORDER BY n.note_date, n.note_no`)).map((r) => ({
    id: r.id, noteNo: r.note_no, noteType: r.note_type, noteDate: r.note_date, invoiceId: r.invoice_id, invoiceNo: r.invoice_no, invoiceDate: r.invoice_date,
    customerGstin: r.customer_gstin ?? null, placeOfSupply: r.place_of_supply, supplyType: r.supply_type, invoiceTotalMinor: big(r.inv_total), withinS34Window: r.within_s34_window === true,
    taxableMinor: big(r.taxable_minor), cgstMinor: big(r.cgst_minor), sgstMinor: big(r.sgst_minor), igstMinor: big(r.igst_minor), cessMinor: big(r.cess_minor), totalMinor: big(r.total_minor),
  }));
}

export async function prepareRunTx(tx: Tx, meta: ActorMeta, input: PrepareInput, cfg: GstrConfig = GSTR_CONFIG) {
  const tenantId = meta.tenantId;
  const biz = await loadBusinessTx(tx, tenantId);
  if (!biz.gstRegistered || !biz.gstin) throw new DomainError("GSTR_NOT_REGISTERED", "this business is not GST-registered; there is no return to prepare");
  if (input.filedOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.filedOn)) throw new DomainError("GSTR_PERIOD", "filedOn must be YYYY-MM-DD");
  const adapter = getAdapter(cfg.jsonSchemaVersion);
  const settings = await getReturnSettingsTx(tx, tenantId, cfg);
  const frequency = settings.filingFrequency;
  const { kind, from, to, fp, ret } = periodRange(input.period, frequency);
  const fy = fyStartOf(from);
  const periodKey = input.period;

  // current-period documents
  const invoices = await loadInvoicesTx(tx, tenantId, sql`invoice_date >= ${from}::date AND invoice_date <= ${to}::date`);
  const notes = await loadNotesTx(tx, tenantId, sql`n.note_date >= ${from}::date AND n.note_date <= ${to}::date`);
  const issuedInvoiceNos = invoices.map((i) => i.invoiceNo);
  const issuedCreditNos = notes.filter((n) => n.noteType === "credit").map((n) => n.noteNo);
  const issuedDebitNos = notes.filter((n) => n.noteType === "debit").map((n) => n.noteNo);

  const advRows = rowsOf(await tx.execute(sql`SELECT a.id, a.receipt_date::text AS receipt_date, a.place_of_supply, a.supply_type, a.gst_rate_pct::text, a.taxable_minor::text,
      a.cgst_minor::text, a.sgst_minor::text, a.igst_minor::text, ai.invoice_date::text AS adj_date
    FROM ar.advance_receipts a LEFT JOIN ar.sales_invoices ai ON ai.tenant_id = a.tenant_id AND ai.id = a.adjusted_invoice_id AND ai.status = 'issued'
    WHERE a.tenant_id = ${tenantId}::uuid AND ((a.receipt_date >= ${from}::date AND a.receipt_date <= ${to}::date) OR (ai.invoice_date >= ${from}::date AND ai.invoice_date <= ${to}::date))`));
  const advances: AdvanceIn[] = advRows.map((r) => ({ id: r.id, receiptDate: r.receipt_date, placeOfSupply: r.place_of_supply, supplyType: r.supply_type, ratePct: r.gst_rate_pct,
    taxableMinor: big(r.taxable_minor), cgstMinor: big(r.cgst_minor), sgstMinor: big(r.sgst_minor), igstMinor: big(r.igst_minor), adjustedInvoiceDate: r.adj_date ?? null }));

  // earlier prepared runs in the same FY: late documents + amendments (+ IFF-reported documents for a quarterly return)
  const prior = rowsOf(await tx.execute(sql`SELECT DISTINCT ON (kind, frequency, period_key) kind, from_date::text AS from_date, to_date::text AS to_date, summary, created_at::text AS created_at
    FROM gl.gst_return_runs WHERE tenant_id = ${tenantId}::uuid AND from_date >= ${fy}::date AND from_date <= ${to}::date AND NOT (kind = ${kind} AND period_key = ${periodKey})
    ORDER BY kind, frequency, period_key, run_no DESC`));
  const priorIndex: Record<string, string> = {}; const priorCoverage: Array<{ from: string; to: string }> = []; const iffReported = new Set<string>();
  for (const p of prior) {
    const idx = (p.summary?.docIndex ?? {}) as Record<string, string>;
    if (p.to_date < from) { Object.assign(priorIndex, idx); priorCoverage.push({ from: p.from_date, to: p.to_date }); }
    if (p.kind === "iff" && kind === "periodic" && p.from_date >= from && p.to_date <= to) for (const k of Object.keys(idx)) iffReported.add(k);
  }
  let earlierInvoices: InvoiceIn[] = []; let earlierNotes: NoteIn[] = [];
  if (priorCoverage.length > 0) {
    const invNos = Object.keys(priorIndex).filter((k) => k.startsWith("inv:")).map((k) => k.slice(4));
    const ntNos = Object.keys(priorIndex).filter((k) => k.startsWith("nt:")).map((k) => k.slice(3));
    const earliestRun = prior.filter((p) => p.to_date < from).map((p) => p.created_at as string).sort()[0]!;
    const inNos = (col: ReturnType<typeof sql>, nos: string[]) => (nos.length ? sql`${col} IN (${sql.join(nos.map((n) => sql`${n}`), sql`, `)})` : sql`false`);
    earlierInvoices = await loadInvoicesTx(tx, tenantId, sql`invoice_date >= ${fy}::date AND invoice_date < ${from}::date AND (issued_at >= ${earliestRun}::timestamptz OR ${inNos(sql`invoice_no`, invNos)})`);
    earlierNotes = await loadNotesTx(tx, tenantId, sql`n.note_date >= ${fy}::date AND n.note_date < ${from}::date AND (n.issued_at >= ${earliestRun}::timestamptz OR ${inNos(sql`n.note_no`, ntNos)})`);
  }

  const hsnCodes = [...new Set(invoices.flatMap((i) => i.lines.map((l) => l.hsnSac)).filter((c): c is string => !!c))];
  const hsnPrefixes = [...new Set(hsnCodes.flatMap((c) => [c, c.slice(0, 4), c.slice(0, 2)]))];
  const hsnMaster: HsnMeta[] = hsnPrefixes.length === 0 ? [] : rowsOf(await tx.execute(sql`SELECT code, description FROM gl.finance_hsn_sac_master
    WHERE code IN (${sql.join(hsnPrefixes.map((c) => sql`${c}`), sql`, `)})`)).map((r) => ({ code: r.code, description: r.description }));

  const prevFy = await turnoverTx(tx, tenantId, addYears(fy, -1), dayBefore(fy));
  const curFy = await turnoverTx(tx, tenantId, fy, dayBefore(from));

  const g1 = buildGstr1({
    cfg, gstin: biz.gstin, fp, fromDate: from, toDate: to, invoices, notes, advances, issuedInvoiceNos, issuedCreditNos, issuedDebitNos, hsnMaster,
    prevFyTurnoverMinor: prevFy, curFyTurnoverMinor: curFy, priorIndex, priorCoverage, earlierInvoices, earlierNotes, iffReported,
  });
  const warnings = [...g1.warnings];
  if (iffReported.size > 0) warnings.push(`IFF_ALREADY_REPORTED: ${iffReported.size} document(s) furnished through the IFF are not repeated in B2B / CDNR`);

  let gstr3bJson: Record<string, unknown> | null = null;
  let recon: ReturnType<typeof reconcile> | null = null;
  let g3Summary: Record<string, unknown> | null = null;
  const gstr1Json = kind === "iff" ? adapter.iff(g1) : adapter.gstr1(g1);

  if (kind === "iff") {
    const iffTaxable = g1.b2b.flatMap((c) => c.inv).reduce((a, d) => a + d.items.reduce((s, b) => s + b.taxable, 0n), 0n);
    if (iffTaxable > cfg.iffMonthlyCapMinor) warnings.push(`IFF_CAP: B2B taxable value ${iffTaxable} paise exceeds the monthly IFF cap ${cfg.iffMonthlyCapMinor} (CA-VERIFY)`);
    recon = { ok: true, checks: [], unmatchedDocs: [], note: "IFF carries B2B + CDN only; reconciliation to GSTR-3B happens in the quarterly return" };
  } else {
    const rangeIds = new Set([...invoices.map((i) => i.id), ...notes.map((n) => n.id)]);
    const lateIds = [...g1.docTax.keys()].filter((id) => !rangeIds.has(id));
    const lateClause = lateIds.length ? sql` OR COALESCE(source_doc_id, invoice_id) IN (${idList(lateIds)})` : sql``;
    const led = rowsOf(await tx.execute(sql`SELECT direction, gst_type, taxable_minor::text, tax_minor::text, invoice_date::text AS invoice_date, source_doc_type,
        COALESCE(source_doc_id, invoice_id) AS doc_id, rcm, itc_category, (rcm_itc_claimed_at AT TIME ZONE 'Asia/Kolkata')::date::text AS claimed_on
      FROM gl.finance_gst_ledger WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
        AND ((invoice_date >= ${from}::date AND invoice_date <= ${to}::date) OR ((rcm_itc_claimed_at AT TIME ZONE 'Asia/Kolkata')::date >= ${from}::date AND (rcm_itc_claimed_at AT TIME ZONE 'Asia/Kolkata')::date <= ${to}::date)${lateClause})`));
    const ledger: LedgerRow[] = led.map((r) => ({ direction: r.direction, gstType: r.gst_type, taxableMinor: big(r.taxable_minor), taxMinor: big(r.tax_minor), invoiceDate: r.invoice_date,
      sourceDocType: r.source_doc_type ?? null, sourceDocId: r.doc_id ?? null, rcm: r.rcm === true, itcCategory: r.itc_category ?? null, rcmItcClaimedOn: r.claimed_on ?? null }));
    const docMeta = new Map<string, DocMeta>();
    for (const i of [...invoices, ...earlierInvoices]) docMeta.set(i.id, { pos: i.placeOfSupply, gstin: i.customerGstin, supplyType: i.supplyType });
    for (const n of [...notes, ...earlierNotes]) docMeta.set(n.id, { pos: n.placeOfSupply, gstin: n.customerGstin, supplyType: n.supplyType });
    const g3 = buildGstr3b({ cfg, gstin: biz.gstin, ret, fromDate: from, toDate: to, frequency, ledger, docMeta, gstr1: g1, prevFyTurnoverMinor: prevFy, filedOn: input.filedOn ?? null });
    recon = reconcile(g1, g3, ledger);
    gstr3bJson = adapter.gstr3b(g3);
    warnings.push(...g3.warnings);
    if (!recon.ok) warnings.push("RECONCILIATION_MISMATCH: GSTR-1 (invoices) and GSTR-3B (gst ledger) disagree; see the reconciliation block before filing");
    if (frequency === "quarterly") warnings.push("QRMP: monthly tax payment (PMT-06 / fixed-sum) is not modelled in v1");
    g3Summary = { dueDate: g3.dueDate, lateDays: g3.lateDays, isNil: g3.isNil, payableMinor: headsTotal(g3.payment.payable), rcmCashMinor: headsTotal(g3.payment.rcmCash), cashMinor: headsTotal(g3.payment.cash),
      itcNetMinor: headsTotal(g3.itcNet), interestMinor: headsTotal(g3.interest), lateFeeMinor: g3.lateFeeCgst + g3.lateFeeSgst };
  }

  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}|gstr|${kind}|${periodKey}`}))`);
  const runNo = Number(rowsOf(await tx.execute(sql`SELECT COALESCE(MAX(run_no), 0) + 1 AS n FROM gl.gst_return_runs
    WHERE tenant_id = ${tenantId}::uuid AND kind = ${kind} AND frequency = ${frequency} AND period_key = ${periodKey}`))[0]?.n ?? 1);
  const summary = {
    range: { from, to }, frequency, kind, jsonSchemaVersion: adapter.version, caVerify: ["jsonSchemaVersion", "b2clThreshold", "hsnDigits", "interest", "lateFee", "qrmp"],
    config: { b2clThresholdMinor: cfg.b2clThresholdMinor, hsnTurnoverCeilingMinor: cfg.hsnTurnoverCeilingMinor, interestBps: cfg.interestBps },
    counts: { b2b: g1.b2b.reduce((a, c) => a + c.inv.length, 0), b2cl: g1.b2cl.reduce((a, c) => a + c.inv.length, 0), b2cs: g1.b2cs.length, cdnr: g1.cdnr.reduce((a, c) => a + c.nt.length, 0),
      cdnur: g1.cdnur.length, exp: g1.exp.reduce((a, c) => a + c.inv.length, 0), nil: g1.nil.length, hsn: g1.hsn.length, docIssue: g1.docIssue.length, at: g1.at.length, txpd: g1.txpd.length,
      b2ba: g1.b2ba.reduce((a, c) => a + c.inv.length, 0), cdnra: g1.cdnra.reduce((a, c) => a + c.nt.length, 0) },
    totals: { taxedOutwardTaxableMinor: g1.taxedOutward.taxable, taxedOutward: g1.taxedOutward.heads, taxedExportTaxableMinor: g1.taxedExport.taxable, taxedExport: g1.taxedExport.heads,
      exportNoTaxTaxableMinor: g1.exportNoTaxTaxable, nilTaxableMinor: g1.nilTaxable },
    gstr3b: g3Summary, docIndex: g1.docIndex,
  };
  const inserted = rowsOf(await tx.execute(sql`INSERT INTO gl.gst_return_runs (tenant_id, kind, frequency, period_key, from_date, to_date, run_no, schema_version, gstin, gstr1_json, gstr3b_json, summary, reconciliation, warnings, created_by)
    VALUES (${tenantId}::uuid, ${kind}, ${frequency}, ${periodKey}, ${from}::date, ${to}::date, ${runNo}, ${adapter.version}, ${biz.gstin}, ${ser(gstr1Json)}::jsonb,
      ${gstr3bJson ? ser(gstr3bJson) : null}::jsonb, ${ser(summary)}::jsonb, ${ser(recon)}::jsonb, ${ser(warnings)}::jsonb, ${meta.actorId}::uuid)
    RETURNING id`))[0]!;
  await auditEvent(tx, meta, "prepare_gst_return", "gst_return_run", inserted.id, { kind, period: periodKey, runNo, reconciled: recon.ok });
  return getRunTx(tx, tenantId, inserted.id);
}

const runOut = (r: Row) => ({
  id: r.id, kind: r.kind, frequency: r.frequency, periodKey: r.period_key, fromDate: r.from_date, toDate: r.to_date, runNo: r.run_no, schemaVersion: r.schema_version, gstin: r.gstin,
  summary: r.summary, reconciliation: r.reconciliation, warnings: r.warnings, createdAt: r.created_at, createdBy: r.created_by,
});

export async function getRunTx(tx: Tx, tenantId: string, id: string) {
  const r = rowsOf(await tx.execute(sql`SELECT id, kind, frequency, period_key, from_date::text AS from_date, to_date::text AS to_date, run_no, schema_version, gstin, gstr1_json, gstr3b_json,
      summary, reconciliation, warnings, created_by, created_at FROM gl.gst_return_runs WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`))[0];
  if (!r) throw new DomainError("GSTR_RUN_NOT_FOUND", "no such prepared return run");
  return { ...runOut(r), gstr1: r.gstr1_json, gstr3b: r.gstr3b_json };
}

export async function listRunsTx(tx: Tx, tenantId: string) {
  return rowsOf(await tx.execute(sql`SELECT id, kind, frequency, period_key, from_date::text AS from_date, to_date::text AS to_date, run_no, schema_version, gstin, summary, reconciliation, warnings,
      created_by, created_at FROM gl.gst_return_runs WHERE tenant_id = ${tenantId}::uuid ORDER BY period_key DESC, kind, run_no DESC LIMIT 200`)).map(runOut);
}
export type { Gstr1Model };
