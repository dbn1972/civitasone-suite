import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";
import type { VendorBlacklistRow } from "./schema.js";
import * as vendorRepo from "../vendor/repo.js";

const PROC_ROLES = ["procurement_officer", "procurement_admin", "super_admin"];
const CENTRAL_DEBARMENT_ROLES = ["super_admin"]; // CVC / central debarring authority
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const createBody = z.object({
  reason: z.string().min(1).max(1000),
  blacklistedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  blacklistedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  orderRef: z.string().max(128).optional(),
});

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const centralDebarmentBody = z.object({
  pan: z.string().regex(PAN_RE, "PAN must be 10 chars (AAAAA9999A)"),
  reason: z.string().min(1).max(1000),
  blacklistedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  blacklistedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  orderRef: z.string().max(128).optional(),
});

function toApi(r: VendorBlacklistRow): Record<string, unknown> {
  return {
    id: r.id,
    tenantId: r.tenantId,
    vendorId: r.vendorId,
    reason: r.reason,
    blacklistedFrom: r.blacklistedFrom,
    blacklistedUntil: r.blacklistedUntil,
    orderRef: r.orderRef,
    createdAt: r.blacklistedAt,
    createdBy: r.createdBy ?? r.blacklistedBy,
    active: r.status === "active",
  };
}

export async function vendorBlacklistRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/procurement/vendors/:id/blacklist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = createBody.parse(req.body);

    // Tenant-scoped vendor existence check (tenant isolation).
    const vendor = await vendorRepo.findVendorById(id, ctx.tenantId);
    if (!vendor) throw new HttpError(404, "NOT_FOUND", "vendor not found");

    const existing = await repo.findActive(ctx.tenantId, id);
    if (existing) {
      throw new HttpError(409, "ALREADY_BLACKLISTED", "vendor is already blacklisted");
    }

    const record = await repo.insertBlacklist({
      tenantId: ctx.tenantId,
      vendorId: id,
      reason: body.reason,
      blacklistedBy: ctx.actorId,
      createdBy: ctx.actorId,
      blacklistedFrom: body.blacklistedFrom,
      blacklistedUntil: body.blacklistedUntil ?? null,
      orderRef: body.orderRef ?? null,
      status: "active",
    });

    // Defense-in-depth: reflect on the vendor row so legacy vendorType checks agree.
    await db.transaction(async (tx) => {
      await vendorRepo.updateVendor(tx, id, {
        vendorType: "blacklisted",
        blacklistReason: body.reason,
        updatedBy: ctx.actorId,
        version: (vendor.version ?? 1) + 1,
      });
    });

    return reply.code(201).send({ data: toApi(record) });
  });

  // R17 — record a CVC / government-wide debarment by PAN. Restricted to the
  // central debarring authority (super_admin). Such an entry blocks the firm's
  // PAN in EVERY tenant at the award/PO gate (isCentrallyDebarredTx), not just
  // the recording tenant. Idempotent on an already-active PAN.
  app.post("/v1/procurement/central-debarment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CENTRAL_DEBARMENT_ROLES);
    const body = centralDebarmentBody.parse(req.body);
    const existing = await repo.findActiveCentralByPan(body.pan);
    if (existing) {
      throw new HttpError(409, "ALREADY_DEBARRED", "PAN already has an active central debarment");
    }
    const record = await repo.insertBlacklist({
      tenantId: ctx.tenantId,        // recording authority's tenant
      vendorId: NIL_UUID,            // central debarment matches by PAN, not a per-tenant vendor id
      scope: "central",
      pan: body.pan.toUpperCase(),
      reason: body.reason,
      blacklistedBy: ctx.actorId,
      createdBy: ctx.actorId,
      blacklistedFrom: body.blacklistedFrom,
      blacklistedUntil: body.blacklistedUntil ?? null,
      orderRef: body.orderRef ?? null,
      status: "active",
    });
    return reply.code(201).send({ data: { ...toApi(record), scope: record.scope, pan: record.pan } });
  });

  // List active CVC / government-wide debarments (visible to every tenant).
  app.get("/v1/procurement/central-debarment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await repo.listActiveCentral(q.limit, q.offset);
    return reply.send({ data: rows.map((r) => ({ ...toApi(r), scope: r.scope, pan: r.pan })), total: rows.length });
  });

  app.get("/v1/procurement/vendor-blacklist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await repo.listActiveByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows.map(toApi), total: rows.length });
  });

  app.get("/v1/procurement/vendors/blacklisted", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await repo.listActiveByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows.map(toApi), total: rows.length });
  });

  app.delete("/v1/procurement/vendors/:id/blacklist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const entry = await repo.findActive(ctx.tenantId, id);
    if (!entry) {
      throw new HttpError(404, "NOT_FOUND", "vendor not in blacklist");
    }
    await repo.reinstate(ctx.tenantId, id, ctx.actorId);
    const vendor = await vendorRepo.findVendorById(id, ctx.tenantId);
    if (vendor) {
      await db.transaction(async (tx) => {
        await vendorRepo.updateVendor(tx, id, {
          vendorType: "registered",
          updatedBy: ctx.actorId,
          version: (vendor.version ?? 1) + 1,
        });
      });
    }
    return reply.code(200).send({ data: toApi({ ...entry, status: "reinstated" }), message: "vendor reinstated" });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
