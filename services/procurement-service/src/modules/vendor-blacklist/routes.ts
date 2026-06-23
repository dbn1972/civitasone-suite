import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const PROC_ROLES = ["procurement_officer", "procurement_admin", "super_admin"];

interface VendorBlacklist {
  id: string;
  tenantId: string;
  vendorId: string;
  reason: string;
  blacklistedFrom: string;
  blacklistedUntil: string | null;
  orderRef: string | null;
  createdAt: string;
  createdBy: string;
  active: boolean;
}

const store: VendorBlacklist[] = [];

const createBody = z.object({
  reason: z.string().min(1).max(1000),
  blacklistedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  blacklistedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  orderRef: z.string().max(128).optional(),
});

export async function vendorBlacklistRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/procurement/vendors/:id/blacklist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = createBody.parse(req.body);

    const existing = store.find((r) => r.vendorId === id && r.tenantId === ctx.tenantId && r.active);
    if (existing) {
      throw new HttpError(409, "ALREADY_BLACKLISTED", "vendor is already blacklisted");
    }

    const record: VendorBlacklist = {
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      vendorId: id,
      reason: body.reason,
      blacklistedFrom: body.blacklistedFrom,
      blacklistedUntil: body.blacklistedUntil ?? null,
      orderRef: body.orderRef ?? null,
      createdAt: new Date().toISOString(),
      createdBy: ctx.actorId,
      active: true,
    };
    store.push(record);
    return reply.code(201).send({ data: record });
  });

  app.get("/v1/procurement/vendor-blacklist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = store.filter((r) => r.tenantId === ctx.tenantId && r.active);
    return reply.send({ data: rows.slice(q.offset, q.offset + q.limit), total: rows.length });
  });

  app.get("/v1/procurement/vendors/blacklisted", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = store.filter((r) => r.tenantId === ctx.tenantId && r.active);
    return reply.send({ data: rows.slice(q.offset, q.offset + q.limit), total: rows.length });
  });

  app.delete("/v1/procurement/vendors/:id/blacklist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const entry = store.find((r) => r.vendorId === id && r.tenantId === ctx.tenantId && r.active);
    if (!entry) {
      throw new HttpError(404, "NOT_FOUND", "vendor not in blacklist");
    }
    entry.active = false;
    return reply.code(200).send({ data: entry, message: "vendor reinstated" });
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
