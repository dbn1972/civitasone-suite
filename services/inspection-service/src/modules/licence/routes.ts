/**
 * Licence Compliance module — HTTP routes.
 *
 * Endpoints:
 *   POST  /v1/inspection/licences               — register licence
 *   PATCH /v1/inspection/licences/:id            — update licence
 *   POST  /v1/inspection/licences/:id/renew      — initiate renewal
 *   POST  /v1/inspection/licences/:id/suspend    — suspend licence
 *   POST  /v1/inspection/licences/:id/revoke     — revoke licence
 *   GET   /v1/inspection/licences/:id            — get by ID
 *   GET   /v1/inspection/licences                — list (filters)
 *   GET   /v1/inspection/licences/expiring       — list expiring within N days
 *
 * _Requirements: SVC-108_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  publishLicenceCreate,
  publishLicenceUpdate,
  publishLicenceRenew,
  publishLicenceSuspend,
  publishLicenceRevoke,
} from "./commands.js";
import { findLicenceById, findLicences, findExpiringLicences } from "./repo.js";

// ─── RBAC ────────────────────────────────────────────────────────────────────

const WRITE_ROLES = ["inspector", "reviewing_officer", "inspection_admin",
  "tenant_admin", "super_admin"];
const READ_ROLES = ["inspector", "reviewing_officer", "inspection_admin",
  "tenant_admin", "super_admin"];

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() });

const createLicenceSchema = z.object({
  entityId: z.string().uuid(),
  licenceType: z.string().min(1),
  licenceNumber: z.string().min(1),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  conditions: z.array(z.unknown()).optional(),
  renewalFee: z.string().optional(),
  currency: z.string().length(3).optional(),
});

const updateLicenceSchema = z.object({
  licenceType: z.string().min(1).optional(),
  licenceNumber: z.string().min(1).optional(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  conditions: z.array(z.unknown()).optional(),
  renewalFee: z.string().optional(),
  version: z.number().int().positive(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(15),
  entityId: z.string().uuid().optional(),
  status: z.string().optional(),
});

const expiringQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(15),
  days: z.coerce.number().int().positive().default(30),
});

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerLicenceRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/inspection/licences ──
  app.post("/v1/inspection/licences", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createLicenceSchema.parse(req.body);
    const result = await publishLicenceCreate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── PATCH /v1/inspection/licences/:id ──
  app.patch("/v1/inspection/licences/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const licence = await findLicenceById(ctx.tenantId, id);
    if (!licence) throw new HttpError(404, "NOT_FOUND", "licence not found");

    const body = updateLicenceSchema.parse(req.body);
    const result = await publishLicenceUpdate({ licenceId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/licences/:id/renew ──
  app.post("/v1/inspection/licences/:id/renew", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const licence = await findLicenceById(ctx.tenantId, id);
    if (!licence) throw new HttpError(404, "NOT_FOUND", "licence not found");

    const result = await publishLicenceRenew({ licenceId: id }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/licences/:id/suspend ──
  app.post("/v1/inspection/licences/:id/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const licence = await findLicenceById(ctx.tenantId, id);
    if (!licence) throw new HttpError(404, "NOT_FOUND", "licence not found");

    const result = await publishLicenceSuspend({ licenceId: id }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/licences/:id/revoke ──
  app.post("/v1/inspection/licences/:id/revoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const licence = await findLicenceById(ctx.tenantId, id);
    if (!licence) throw new HttpError(404, "NOT_FOUND", "licence not found");

    const result = await publishLicenceRevoke({ licenceId: id }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/licences/expiring ── (must be before :id)
  app.get("/v1/inspection/licences/expiring", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = expiringQuerySchema.parse(req.query);
    const result = await findExpiringLicences(
      ctx.tenantId,
      query.days,
      { page: query.page, pageSize: query.pageSize },
    );
    return reply.send(result);
  });

  // ── GET /v1/inspection/licences/:id ──
  app.get("/v1/inspection/licences/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const licence = await findLicenceById(ctx.tenantId, id);
    if (!licence) throw new HttpError(404, "NOT_FOUND", "licence not found");
    return reply.send({ data: licence });
  });

  // ── GET /v1/inspection/licences ──
  app.get("/v1/inspection/licences", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listQuerySchema.parse(req.query);
    const result = await findLicences(
      ctx.tenantId,
      { page: query.page, pageSize: query.pageSize },
      { entityId: query.entityId, status: query.status },
    );
    return reply.send(result);
  });
}
