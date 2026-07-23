/**
 * Enforcement module — HTTP routes.
 *
 * Endpoints:
 *   POST /v1/inspection/enforcement/penalty-rates — configure rate
 *   GET  /v1/inspection/enforcement/penalty-rates — list rates
 *   POST /v1/inspection/enforcement/show-cause — issue show cause
 *   POST /v1/inspection/enforcement/show-cause/:id/respond — record response
 *   POST /v1/inspection/enforcement/penalty-orders — create order (draft)
 *   POST /v1/inspection/enforcement/penalty-orders/:id/issue — issue order
 *   POST /v1/inspection/enforcement/penalty-orders/:id/refer-prosecution
 *   GET  /v1/inspection/enforcement/penalty-orders/:id — get order
 *   GET  /v1/inspection/enforcement/penalty-orders — list orders
 *
 * _Requirements: SVC-107_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  publishPenaltyRateCreate,
  publishShowCauseCreate,
  publishShowCauseRespond,
  publishPenaltyOrderCreate,
  publishPenaltyOrderIssue,
  publishProsecutionRefer,
} from "./commands.js";
import {
  findPenaltyRates,
  findPenaltyOrderById,
  findPenaltyOrders,
  findShowCauseById,
} from "./repo.js";

// ─── RBAC ────────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ["inspection_admin", "tenant_admin", "super_admin"];
const WRITE_ROLES = ["inspector", "reviewing_officer", "inspection_admin",
  "tenant_admin", "super_admin"];
const READ_ROLES = ["inspector", "reviewing_officer", "inspection_admin",
  "tenant_admin", "super_admin"];

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() });

const penaltyRateSchema = z.object({
  provisionId: z.string().uuid(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amount: z.string().min(1, "amount is required (bigint paise as string)"),
  currency: z.string().length(3).optional(),
  description: z.string().optional(),
});

const showCauseSchema = z.object({
  findingId: z.string().uuid(),
  entityId: z.string().uuid(),
  issuedTo: z.string().min(1),
  responseDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const showCauseRespondSchema = z.object({
  responseText: z.string().min(1, "responseText is required"),
});

const penaltyOrderSchema = z.object({
  findingId: z.string().uuid(),
  entityId: z.string().uuid(),
  showCauseId: z.string().uuid().optional(),
  penaltyRateId: z.string().uuid().optional(),
  amount: z.string().min(1, "amount is required (bigint paise as string)"),
  currency: z.string().length(3).optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(15),
  status: z.string().optional(),
  entityId: z.string().uuid().optional(),
});

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerEnforcementRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/inspection/enforcement/penalty-rates ──
  app.post("/v1/inspection/enforcement/penalty-rates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = penaltyRateSchema.parse(req.body);
    const result = await publishPenaltyRateCreate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/enforcement/penalty-rates ──
  app.get("/v1/inspection/enforcement/penalty-rates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listQuerySchema.parse(req.query);
    const result = await findPenaltyRates(ctx.tenantId, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return reply.send(result);
  });

  // ── POST /v1/inspection/enforcement/show-cause ──
  app.post("/v1/inspection/enforcement/show-cause", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = showCauseSchema.parse(req.body);
    const result = await publishShowCauseCreate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/enforcement/show-cause/:id/respond ──
  app.post(
    "/v1/inspection/enforcement/show-cause/:id/respond",
    async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, WRITE_ROLES);
      const { id } = idParam.parse(req.params);

      const notice = await findShowCauseById(ctx.tenantId, id);
      if (!notice) throw new HttpError(404, "NOT_FOUND", "show cause notice not found");

      const body = showCauseRespondSchema.parse(req.body);
      const result = await publishShowCauseRespond({ showCauseId: id, ...body }, ctx);
      return reply.code(202).send({ data: result });
    },
  );

  // ── POST /v1/inspection/enforcement/penalty-orders ──
  app.post("/v1/inspection/enforcement/penalty-orders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = penaltyOrderSchema.parse(req.body);
    const result = await publishPenaltyOrderCreate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/enforcement/penalty-orders/:id/issue ──
  app.post(
    "/v1/inspection/enforcement/penalty-orders/:id/issue",
    async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, WRITE_ROLES);
      const { id } = idParam.parse(req.params);

      const order = await findPenaltyOrderById(ctx.tenantId, id);
      if (!order) throw new HttpError(404, "NOT_FOUND", "penalty order not found");

      const result = await publishPenaltyOrderIssue({ penaltyOrderId: id }, ctx);
      return reply.code(202).send({ data: result });
    },
  );

  // ── POST /v1/inspection/enforcement/penalty-orders/:id/refer-prosecution ──
  app.post(
    "/v1/inspection/enforcement/penalty-orders/:id/refer-prosecution",
    async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, WRITE_ROLES);
      const { id } = idParam.parse(req.params);

      const order = await findPenaltyOrderById(ctx.tenantId, id);
      if (!order) throw new HttpError(404, "NOT_FOUND", "penalty order not found");

      const result = await publishProsecutionRefer({ penaltyOrderId: id }, ctx);
      return reply.code(202).send({ data: result });
    },
  );

  // ── GET /v1/inspection/enforcement/penalty-orders/:id ──
  app.get(
    "/v1/inspection/enforcement/penalty-orders/:id",
    async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, READ_ROLES);
      const { id } = idParam.parse(req.params);
      const order = await findPenaltyOrderById(ctx.tenantId, id);
      if (!order) throw new HttpError(404, "NOT_FOUND", "penalty order not found");
      return reply.send({ data: order });
    },
  );

  // ── GET /v1/inspection/enforcement/penalty-orders ──
  app.get("/v1/inspection/enforcement/penalty-orders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listQuerySchema.parse(req.query);
    const result = await findPenaltyOrders(
      ctx.tenantId,
      { page: query.page, pageSize: query.pageSize },
      { status: query.status, entityId: query.entityId },
    );
    return reply.send(result);
  });
}
