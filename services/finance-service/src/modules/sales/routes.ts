/**
 * MSME commercial M2: customer master, sales invoicing, advance receipts, credit / debit notes, AR ageing and the mobile invoice
 * sync route. Registered by app.ts. EVERY route is behind one centralised preHandler (shared/commercial-gate.ts) that reads the
 * tenant's stored coa_template and answers 404 COMMERCIAL_NOT_ENABLED for a govt tenant; there is no per-handler tenant check.
 * Issuing a document is accepted synchronously (the number + AR entry commit in the request tx) and its Dr AR / Cr revenue journal
 * is posted asynchronously by the GL consumer via the outbox. The GST output GL line is slice M3b -- not here.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zIsoDate } from "@civitasone/schemas/validators";
import { resolveDocIdentity, DocumentUnavailableError } from "@civitasone/render/official";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { commercialTenantGate } from "../../shared/commercial-gate.js";
import { db, scopedRead } from "../../shared/db.js";
import { DomainError } from "../approvals/domain.js";
import { postingDateWindow } from "../gl/validators.js";
import { COA_INCOMPLETE_CODE } from "../gl/commercial-chart.js";
import { NOTE_REASONS, NOTE_TYPES, INVOICE_STATUSES } from "./schema.js";
import {
  createCustomerTx, updateCustomerTx, getCustomerTx, listCustomersTx, createDraftInvoiceTx, replaceDraftInvoiceTx, deleteDraftInvoiceTx, getInvoiceTx,
  listInvoicesTx, issueInvoiceTx, createAdvanceReceiptTx, listAdvanceReceiptsTx, createNoteTx, issueNoteTx, listNotesTx, arAgeingTx, customerLedgerTx,
  syncMobileInvoiceTx,
} from "./service.js";
import { renderInvoicePdf, type InvoiceDocModel } from "./invoice-pdf.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];
const MAKER_ROLES = ["finance_officer", "finance_admin", "super_admin"];

const minor = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));
const idParam = z.object({ id: z.string().uuid() });
const rate = z.union([z.string().regex(/^\d{1,3}(\.\d{1,2})?$/), z.number().nonnegative().max(100)]);
const gstin = z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "not a valid GSTIN");
const stateCode = z.string().regex(/^\d{2}$/);
const postingDate = (label: string) => zIsoDate({ window: postingDateWindow, label });

const customerBody = z.object({
  customerCode: z.string().trim().min(1).max(32), name: z.string().trim().min(1).max(200), gstin: gstin.optional(), stateCode: stateCode.optional(),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/).optional(), address: z.string().trim().max(500).optional(),
  email: z.string().trim().email().max(200).optional(), phone: z.string().trim().max(32).optional(),
  creditDays: z.number().int().min(0).max(365).optional(), creditLimitMinor: minor.optional(),
});
const customerPatch = customerBody.omit({ customerCode: true }).partial().extend({ isActive: z.boolean().optional() });

const lineBody = z.object({
  description: z.string().trim().min(1).max(300), hsnSac: z.string().regex(/^[0-9]{4}([0-9]{2}([0-9]{2})?)?$/).optional(),
  qty: z.union([z.string(), z.number()]), uom: z.string().trim().max(8).optional(), rateMinor: minor, discountMinor: minor.optional(), gstRatePct: rate.optional(),
});
const invoiceBody = z.object({
  customerId: z.string().uuid(), invoiceDate: postingDate("invoice date"), supplyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), placeOfSupply: stateCode.optional(), reverseCharge: z.boolean().optional(),
  narration: z.string().trim().max(500).optional(), lines: z.array(lineBody).min(1).max(200),
});
const issueBody = z.object({ advanceReceiptIds: z.array(z.string().uuid()).max(50).optional() }).default({});
const advanceBody = z.object({
  customerId: z.string().uuid(), receiptDate: postingDate("receipt date"), amountMinor: minor, gstRatePct: rate.optional(), placeOfSupply: stateCode.optional(),
  paymentMode: z.string().trim().max(16).optional(), reference: z.string().trim().max(200).optional(),
});
const noteBody = z.object({
  noteType: z.enum(NOTE_TYPES), noteDate: postingDate("note date"), reason: z.enum(NOTE_REASONS), reasonText: z.string().trim().max(500).optional(),
  taxableMinor: minor, gstRatePct: rate.optional(),
});
const mobileBody = z.object({
  id: z.string().uuid(), customerId: z.string().optional(), customerName: z.string().trim().min(1).max(200), dueDate: z.string().optional(),
  placeOfSupply: stateCode.optional(), createdAt: z.string().optional(), invoiceNo: z.string().optional(),
  items: z.array(z.object({ name: z.string().trim().min(1).max(300), qty: z.number().positive(), rate: z.number().int().nonnegative(), gstPercent: z.number().nonnegative().max(100) })).min(1).max(200),
});

const serialise = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

const toHttp = (err: unknown): never => {
  if (err instanceof DomainError) {
    const c = err.code;
    const status = /_NOT_FOUND$/.test(c) ? 404 : /(_EXISTS|NOT_DRAFT|_USED|IMMUTABLE|NOT_ISSUED)$/.test(c) ? 409 : 422;
    throw new HttpError(status, c, err.message);
  }
  if ((err as { code?: string })?.code === COA_INCOMPLETE_CODE) throw new HttpError(422, COA_INCOMPLETE_CODE, (err as Error).message);
  const msg = String((err as Error)?.message ?? "");
  if (/IMMUTABLE/.test(msg)) throw new HttpError(409, "DOCUMENT_IMMUTABLE", msg);
  throw err;
};

export async function salesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", commercialTenantGate);
  const run = async <T>(fn: () => Promise<T>): Promise<T> => { try { return await fn(); } catch (e) { return toHttp(e); } };

  // ---- customers
  app.get("/v1/finance/sales/customers", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    return reply.send({ data: serialise(await scopedRead((tx) => listCustomersTx(tx, ctx.tenantId))) });
  });
  app.post("/v1/finance/sales/customers", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const body = customerBody.parse(req.body);
    const row = await run(() => db.transaction((tx) => createCustomerTx(tx, ctx, body)));
    return reply.code(201).send({ data: serialise(row) });
  });
  app.get("/v1/finance/sales/customers/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: serialise(await run(() => scopedRead((tx) => getCustomerTx(tx, ctx.tenantId, id)))) });
  });
  app.put("/v1/finance/sales/customers/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = customerPatch.parse(req.body);
    return reply.send({ data: serialise(await run(() => db.transaction((tx) => updateCustomerTx(tx, ctx, id, body)))) });
  });
  app.get("/v1/finance/sales/customers/:id/ledger", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: serialise(await run(() => scopedRead((tx) => customerLedgerTx(tx, ctx.tenantId, id)))) });
  });

  // ---- invoices
  app.get("/v1/finance/sales/invoices", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const q = z.object({ status: z.enum(INVOICE_STATUSES).optional(), customerId: z.string().uuid().optional() }).parse(req.query);
    return reply.send({ data: serialise(await scopedRead((tx) => listInvoicesTx(tx, ctx.tenantId, q))) });
  });
  app.post("/v1/finance/sales/invoices", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const body = invoiceBody.parse(req.body);
    const row = await run(() => db.transaction((tx) => createDraftInvoiceTx(tx, ctx, body)));
    return reply.code(201).send({ data: serialise(row) });
  });
  app.get("/v1/finance/sales/invoices/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: serialise(await run(() => scopedRead((tx) => getInvoiceTx(tx, ctx.tenantId, id)))) });
  });
  app.put("/v1/finance/sales/invoices/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = invoiceBody.parse(req.body);
    return reply.send({ data: serialise(await run(() => db.transaction((tx) => replaceDraftInvoiceTx(tx, ctx, id, body)))) });
  });
  app.delete("/v1/finance/sales/invoices/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const { id } = idParam.parse(req.params);
    await run(() => db.transaction((tx) => deleteDraftInvoiceTx(tx, ctx, id)));
    return reply.code(204).send();
  });
  app.post("/v1/finance/sales/invoices/:id/issue", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = issueBody.parse(req.body ?? {});
    const row = await run(() => db.transaction((tx) => issueInvoiceTx(tx, ctx, id, body)));
    return reply.code(202).send({ data: serialise(row), status: "accepted", correlationId: ctx.correlationId });
  });
  app.get("/v1/finance/sales/invoices/:id/pdf", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const inv = await run(() => scopedRead((tx) => getInvoiceTx(tx, ctx.tenantId, id)));
    if (inv.status !== "issued" || !inv.invoiceNo) throw new HttpError(409, "INVOICE_NOT_ISSUED", "only an issued invoice can be printed");
    const model: InvoiceDocModel = {
      kind: "invoice", docNo: inv.invoiceNo, docDate: String(inv.invoiceDate), dueDate: String(inv.dueDate), supplierGstin: inv.supplierGstin, customerName: inv.customerName,
      customerGstin: inv.customerGstin, placeOfSupply: inv.placeOfSupply, placeOfSupplyName: null, supplyType: inv.supplyType, reverseCharge: inv.reverseCharge, refInvoiceNo: null,
      lines: inv.lines.map((l) => ({ description: l.description, hsnSac: l.hsnSac, qty: String(l.qty), rateMinor: l.rateMinor, taxableMinor: l.taxableMinor, gstRatePct: String(l.gstRatePct), taxMinor: l.taxMinor, totalMinor: l.totalMinor })),
      taxableMinor: inv.taxableMinor, cgstMinor: inv.cgstMinor, sgstMinor: inv.sgstMinor, igstMinor: inv.igstMinor, totalMinor: inv.totalMinor, narration: inv.narration,
    };
    try {
      const issuer = await resolveDocIdentity(ctx.tenantId);
      const pdf = Buffer.from(await renderInvoicePdf(model, issuer));
      return reply.header("content-type", "application/pdf").header("content-disposition", `inline; filename="invoice-${inv.invoiceNo.replace(/[^\w.-]+/g, "_")}.pdf"`).send(pdf);
    } catch (err) {
      if (err instanceof DocumentUnavailableError) throw new HttpError(503, err.code, err.message);
      throw err;
    }
  });

  // ---- advance receipts
  app.get("/v1/finance/sales/advance-receipts", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const q = z.object({ customerId: z.string().uuid().optional() }).parse(req.query);
    return reply.send({ data: serialise(await scopedRead((tx) => listAdvanceReceiptsTx(tx, ctx.tenantId, q.customerId))) });
  });
  app.post("/v1/finance/sales/advance-receipts", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const body = advanceBody.parse(req.body);
    return reply.code(201).send({ data: serialise(await run(() => db.transaction((tx) => createAdvanceReceiptTx(tx, ctx, body)))) });
  });

  // ---- credit / debit notes
  app.get("/v1/finance/sales/notes", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const q = z.object({ invoiceId: z.string().uuid().optional() }).parse(req.query);
    return reply.send({ data: serialise(await scopedRead((tx) => listNotesTx(tx, ctx.tenantId, q.invoiceId))) });
  });
  app.post("/v1/finance/sales/invoices/:id/notes", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = noteBody.parse(req.body);
    return reply.code(201).send({ data: serialise(await run(() => db.transaction((tx) => createNoteTx(tx, ctx, { ...body, invoiceId: id })))) });
  });
  app.post("/v1/finance/sales/notes/:id/issue", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await run(() => db.transaction((tx) => issueNoteTx(tx, ctx, id)));
    return reply.code(202).send({ data: serialise(row), status: "accepted", correlationId: ctx.correlationId });
  });

  // ---- AR ageing
  app.get("/v1/finance/sales/ar/ageing", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const q = z.object({ asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
    const asOf = q.asOf ?? new Date().toISOString().slice(0, 10);
    return reply.send({ data: serialise(await run(() => scopedRead((tx) => arAgeingTx(tx, ctx.tenantId, asOf)))) });
  });

  // ---- mobile sync (apps/mobile SyncRouteRegistry 'invoice.create'); replaces the former "no endpoint" dead letter
  app.post("/v1/finance/sales/mobile/invoices", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const body = mobileBody.parse(req.body);
    const row = await run(() => db.transaction((tx) => syncMobileInvoiceTx(tx, ctx, body)));
    return reply.code(201).send({ data: serialise(row) });
  });

  app.setErrorHandler(financeErrorHandler);
}
