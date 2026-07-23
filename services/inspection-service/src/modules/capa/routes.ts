/**
 * CAPA module — HTTP routes (Fastify plugin `registerCapaRoutes`).
 *
 * Follows the suite CQRS + envelope conventions:
 *   • WRITES — `resolveContext` → `requireRole` → zod validate → command publish → 202
 *   • READS  — cache-first `repo.*` lookups
 *
 * Endpoints:
 *   POST   /v1/inspection/capa                        — create CAPA
 *   PATCH  /v1/inspection/capa/:id                    — update (assign owner, set due date)
 *   POST   /v1/inspection/capa/:id/complete           — mark complete with closure evidence
 *   POST   /v1/inspection/capa/:id/verify             — verify effectiveness (maker-checker)
 *   POST   /v1/inspection/capa/:id/trigger-reinspection — trigger re-inspection
 *   GET    /v1/inspection/capa/:id                    — get by ID
 *   GET    /v1/inspection/capa                        — list with filters
 *
 * _Requirements: SVC-106_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  publishCapaCreate,
  publishCapaUpdate,
  publishCapaComplete,
  publishCapaVerify,
  publishCapaTriggerReinspection,
} from "./commands.js";
import { findCapaById, findCapas } from "./repo.js";

// ─── RBAC role groups ────────────────────────────────────────────────────────

const WRITE_ROLES = ["inspector", "reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];
const READ_ROLES = ["inspector", "reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];

// ─── Zod validation schemas ─────────────────────────────────────────────────

const idParam = z.object({
  id: z.string().uuid("id must be a valid UUID"),
});

const createCapaSchema = z.object({
  findingId: z.string().uuid("findingId must be a valid UUID"),
  type: z.enum(["corrective", "preventive"]),
  description: z.string().min(1, "description is required"),
  ownerId: z.string().uuid().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD format").optional(),
});

const updateCapaSchema = z.object({
  ownerId: z.string().uuid().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD format").optional(),
  description: z.string().min(1).optional(),
  version: z.number().int().positive(),
});

const completeCapaSchema = z.object({
  evidenceOfClosure: z.array(z.unknown()).min(1, "at least 1 evidence item required"),
});

const verifyCapaSchema = z.object({
  effectivenessVerified: z.boolean(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(15),
  findingId: z.string().uuid().optional(),
  status: z.string().optional(),
  ownerId: z.string().uuid().optional(),
  overdue: z.coerce.boolean().optional(),
});

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerCapaRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/inspection/capa ──
  app.post("/v1/inspection/capa", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createCapaSchema.parse(req.body);
    const result = await publishCapaCreate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── PATCH /v1/inspection/capa/:id ──
  app.patch("/v1/inspection/capa/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const capa = await findCapaById(ctx.tenantId, id);
    if (!capa) throw new HttpError(404, "NOT_FOUND", "CAPA not found");

    const body = updateCapaSchema.parse(req.body);
    const result = await publishCapaUpdate({ capaId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/capa/:id/complete ──
  app.post("/v1/inspection/capa/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const capa = await findCapaById(ctx.tenantId, id);
    if (!capa) throw new HttpError(404, "NOT_FOUND", "CAPA not found");

    const body = completeCapaSchema.parse(req.body);
    const result = await publishCapaComplete({ capaId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/capa/:id/verify ──
  app.post("/v1/inspection/capa/:id/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const capa = await findCapaById(ctx.tenantId, id);
    if (!capa) throw new HttpError(404, "NOT_FOUND", "CAPA not found");

    const body = verifyCapaSchema.parse(req.body);
    const result = await publishCapaVerify({ capaId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/capa/:id/trigger-reinspection ──
  app.post("/v1/inspection/capa/:id/trigger-reinspection", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const capa = await findCapaById(ctx.tenantId, id);
    if (!capa) throw new HttpError(404, "NOT_FOUND", "CAPA not found");

    const result = await publishCapaTriggerReinspection({ capaId: id }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/capa/:id ──
  app.get("/v1/inspection/capa/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const capa = await findCapaById(ctx.tenantId, id);
    if (!capa) throw new HttpError(404, "NOT_FOUND", "CAPA not found");
    return reply.send({ data: capa });
  });

  // ── GET /v1/inspection/capa ──
  app.get("/v1/inspection/capa", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listQuerySchema.parse(req.query);
    const result = await findCapas(
      ctx.tenantId,
      { page: query.page, pageSize: query.pageSize },
      {
        findingId: query.findingId,
        status: query.status,
        ownerId: query.ownerId,
        overdue: query.overdue,
      },
    );
    return reply.send(result);
  });
}
