import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import type { VendorRow } from "./schema.js";

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
// status enum. Bill-history (bills/billHistory on the detail page) is
// intentionally not populated here — that's a vendor<->bills join with no
// FK to join on yet (see migration 0065's note) and is out of this task's
// scope; the frontend already renders a clean "No bills yet" empty state.
function toVendorDetail(r: VendorRow) {
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
    ifsc: r.ifsc,
    bankAccount: r.bankAccountNo,
    isActive: r.isActive,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
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
    return reply.send(toVendorDetail(vendor));
  });

  app.post("/v1/finance/vendors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const body = createVendorBody.parse(req.body);
    const vendor = await repo.createVendor(ctx.tenantId, {
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
    return reply.code(201).send(toVendorDetail(vendor));
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
    return reply.send(toVendorDetail(updated));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
