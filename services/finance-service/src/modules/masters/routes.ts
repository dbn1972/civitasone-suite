import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as paymentsRepo from "../payments/repo.js";
import * as tdsRepo from "../tds/repo.js";
import type { VendorRow } from "./schema.js";
import type { BillRow } from "../payments/schema.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];
// Vendor master is financial system-of-record data (bank account/IFSC feed
// payment issuance) — writes are gated the same as masters/bank-routes.ts's
// POST /v1/finance/bank-accounts (finance_admin/super_admin only), narrower
// than the read roles above.
const WRITER_ROLES = ["finance_admin", "super_admin"];

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}).partial();

const vendorIdParam = z.object({ id: z.string().uuid() });

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const createVendorBody = z.object({
  name:          z.string().min(2).max(200),
  category:      z.string().min(1).max(100),
  pan:           z.string().length(10).transform((v) => v.toUpperCase()).refine((v) => PAN_RE.test(v), "invalid PAN format (expect AAAAA9999A)"),
  gstin:         z.string().length(15).transform((v) => v.toUpperCase()).refine((v) => GSTIN_RE.test(v), "invalid GSTIN format").optional(),
  address:       z.string().min(2).max(500),
  contactPerson: z.string().min(1).max(200).optional(),
  phone:         z.string().min(6).max(20).optional(),
  email:         z.string().email().max(200).optional(),
  bankName:      z.string().min(2).max(200),
  bankAccount:   z.string().min(5).max(30),
  ifsc:          z.string().length(11).transform((v) => v.toUpperCase()).refine((v) => IFSC_RE.test(v), "invalid IFSC format"),
});

const updateVendorBody = z.object({
  version:       z.number().int().min(1),
  name:          z.string().min(2).max(200).optional(),
  category:      z.string().min(1).max(100).optional(),
  gstin:         z.string().length(15).transform((v) => v.toUpperCase()).refine((v) => GSTIN_RE.test(v), "invalid GSTIN format").optional(),
  address:       z.string().min(2).max(500).optional(),
  contactPerson: z.string().min(1).max(200).optional(),
  phone:         z.string().min(6).max(20).optional(),
  email:         z.string().email().max(200).optional(),
  bankName:      z.string().min(2).max(200).optional(),
  bankAccount:   z.string().min(5).max(30).optional(),
  ifsc:          z.string().length(11).transform((v) => v.toUpperCase()).refine((v) => IFSC_RE.test(v), "invalid IFSC format").optional(),
  isActive:      z.boolean().optional(),
});

// List-view shape: satisfies packages/types VendorSummary (name/category/
// ratingDisplay) exactly, plus id/pan/gstin/status which VendorsTable.tsx
// and the vendors list page also read (via a Record<string,unknown> cast —
// VendorSummary itself doesn't declare them, but the runtime objects must
// carry them for the table's columns and rowLinkKey="id" to work).
// ratingDisplay has no backing data source anywhere in this codebase (no
// vendor rating/review feature exists) — returning a constant "Not rated"
// rather than a fabricated score.
function toVendorSummary(r: VendorRow) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    pan: r.pan,
    gstin: r.gstin,
    status: r.isActive ? "active" : "inactive",
    ratingDisplay: "Not rated",
  };
}

// Detail-view shape: every canonical key the vendor [id] page's field()
// helper probes for (first-listed candidate per field — pan, gstin, address,
// contactPerson, email, phone, bankName, ifsc, bankAccount), plus id/status/
// isActive/version/timestamps. "status" is derived from isActive (this table
// has no separate approval workflow) rather than adding an unrequested
// status enum. Bill history is NOT built in here: this function is also
// reused by the POST/PATCH handlers below, which never need a bill lookup
// for a create/update echo. The GET /:id route fetches it separately (via
// findBillsByVendorAndTenant + toVendorBillHistory, below) and spreads it
// into the response it sends.
// showFullBankDetails gates the cleartext account number/IFSC to
// WRITER_ROLES (finance_admin/super_admin — the roles that actually submit
// PFMS payments and need the real value); finance_officer/audit_officer get
// the same masked shape masters/bank-routes.ts uses for the org's own
// accounts. Keys stay ifsc/bankAccount either way so the frontend's
// field() probes keep working unchanged — only the value is masked.
function toVendorDetail(r: VendorRow, showFullBankDetails: boolean) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    status: r.isActive ? "active" : "inactive",
    pan: r.pan,
    gstin: r.gstin,
    address: r.address,
    contactPerson: r.contactPerson,
    email: r.email,
    phone: r.phone,
    bankName: r.bankName,
    ifsc: showFullBankDetails ? r.ifsc : r.ifsc.slice(0, 4) + "XXXXXXX",
    bankAccount: showFullBankDetails ? r.bankAccountNo : "••••••" + r.bankAccountNo.slice(-4),
    isActive: r.isActive,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// Vendor bill-rollup: the vendor<->bills join the frontend's Total Bills /
// Total Paid / TDS Deducted stat cards and Bill History table need (all
// three stats are derived client-side from this same array, so it's the
// only new field required). Filters on finance_bills.vendor_id directly --
// that column has existed since before the vendor table did (migration
// 0065's note explains why the FK constraint itself is deliberately
// deferred pending a backfill/reconciliation pass), but a FK is only needed
// to ENFORCE referential integrity, not to filter by it, so this rollup was
// always buildable.
//
// TDS is NOT read from the bill's own `deductions` jsonb: the only real
// bill-creation path (integrations/consumer.ts's grnAccepted handler)
// hardcodes deductions: [], and none of payments/consumer.ts's three
// updateBill() call sites ever populate it either, so that column is always
// empty in production. The real TDS ledger is gl.finance_vendor_tds (written
// via POST /v1/finance/vendor-tds -> tds/consumer.ts), keyed by bill_id --
// see tds/repo.ts's findTdsAmountsByBillIds, which this looks up by the ids
// of the bills already fetched above.
function toVendorBillHistory(bills: BillRow[], tdsByBillId: Map<string, bigint>) {
  return bills.map((b) => {
    const tdsMinor = tdsByBillId.get(b.id) ?? 0n;
    return {
      id: b.id,
      billNo: b.billNo,
      date: b.billDate ? String(b.billDate) : new Date(b.createdAt as unknown as string).toISOString().slice(0, 10),
      amount: b.netMinor.toString(),
      tds: tdsMinor.toString(),
      status: b.status,
    };
  });
}

export async function mastersRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/pao", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    listQuerySchema.parse(req.query);
    const rows = await repo.listPao(ctx.tenantId);
    return reply.send({
      data: rows.map((r) => ({ id: r.id, paoCode: r.paoCode, name: r.name, ministry: r.ministry, isActive: r.isActive })),
    });
  });

  app.get("/v1/finance/ddo", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    listQuerySchema.parse(req.query);
    const rows = await repo.listDdo(ctx.tenantId);
    return reply.send({
      data: rows.map((r) => ({ id: r.id, ddoCode: r.ddoCode, name: r.name, paoCode: r.paoCode, isActive: r.isActive })),
    });
  });

  app.get("/v1/finance/vendors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    listQuerySchema.parse(req.query);
    const rows = await repo.listVendors(ctx.tenantId);
    return reply.send({ data: rows.map(toVendorSummary), meta: { page: 1, pageSize: 100, total: rows.length } });
  });

  app.get("/v1/finance/vendors/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = vendorIdParam.parse(req.params);
    const vendor = await repo.getVendorById(ctx.tenantId, id);
    if (!vendor) throw new HttpError(404, "NOT_FOUND", "vendor not found");
    const showFullBankDetails = hasAnyRole(ctx, WRITER_ROLES);
    const bills = await paymentsRepo.findBillsByVendorAndTenant(id, ctx.tenantId);
    const tdsRows = await tdsRepo.findTdsAmountsByBillIds(ctx.tenantId, bills.map((b) => b.id));
    const tdsByBillId = new Map(tdsRows.map((r) => [r.billId, r.tdsAmountMinor]));
    return reply.send({ ...toVendorDetail(vendor, showFullBankDetails), bills: toVendorBillHistory(bills, tdsByBillId) });
  });

  app.post("/v1/finance/vendors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const body = createVendorBody.parse(req.body);
    // FINDING: financeVendors has UNIQUE (tenant_id, pan) — a duplicate PAN
    // previously propagated as a raw PostgresError (500) since vendor
    // creation was blocked end-to-end before the PII_ENC_KEY fix and this
    // path had never been exercised. Clean 409 now, matching the
    // VERSION_CONFLICT 409 the PATCH handler below already gives.
    let vendor;
    try {
      vendor = await repo.createVendor(ctx.tenantId, {
        name: body.name,
        category: body.category,
        pan: body.pan,
        gstin: body.gstin ?? null,
        address: body.address,
        contactPerson: body.contactPerson ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        bankName: body.bankName,
        bankAccountNo: body.bankAccount,
        ifsc: body.ifsc,
      }, ctx.actorId);
    } catch (e) {
      if (repo.isUniqueViolation(e)) {
        throw new HttpError(409, "DUPLICATE_PAN", `a vendor with PAN ${body.pan} already exists for this tenant`);
      }
      throw e;
    }
    // Always full detail: this route is already WRITER_ROLES-only.
    return reply.code(201).send(toVendorDetail(vendor, true));
  });

  app.patch("/v1/finance/vendors/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const { id } = vendorIdParam.parse(req.params);
    const { version, bankAccount, ...rest } = updateVendorBody.parse(req.body);
    const existing = await repo.getVendorById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "vendor not found");
    const updated = await repo.updateVendor(ctx.tenantId, id, version, {
      ...rest,
      ...(bankAccount !== undefined ? { bankAccountNo: bankAccount } : {}),
    }, ctx.actorId);
    if (!updated) throw new HttpError(409, "VERSION_CONFLICT", "vendor was modified by another request; reload and retry");
    // Always full detail: this route is already WRITER_ROLES-only.
    return reply.send(toVendorDetail(updated, true));
  });

  app.setErrorHandler(financeErrorHandler);
}
