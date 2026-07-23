/**
 * execution module — HTTP routes (Fastify plugin `registerExecutionRoutes`, 6 endpoints).
 *
 * Follows the suite CQRS + envelope conventions:
 *   • WRITES — `resolveContext` → `requireRole` → zod validate → command publish → 202
 *   • READS  — cache-first `repo.*` lookups
 *
 * RBAC:
 *   - Transitions: inspector and reviewing_officer
 *   - Finalize: reviewing_officer only
 *   - Reads: inspector, reviewing_officer, supervising_officer
 *
 * Endpoints (6):
 *   POST /v1/inspection/inspections/:id/transition      — trigger state transition
 *   POST /v1/inspection/inspections/:id/submit-review   — submit for review
 *   POST /v1/inspection/inspections/:id/finalize        — finalize inspection
 *   GET  /v1/inspection/inspections/:id                 — get inspection details
 *   GET  /v1/inspection/inspections                     — list inspections
 *   GET  /v1/inspection/inspections/:id/history         — get state transition history
 *
 * _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  publishInspectionTransition,
  publishInspectionSubmitReview,
  publishInspectionFinalize,
} from "./commands.js";
import {
  findInspectionById,
  findInspections,
  findHistoryByInspection,
} from "./repo.js";

// ─── RBAC role groups ────────────────────────────────────────────────────────

/** Transition operations: inspectors and reviewing officers. */
const TRANSITION_ROLES = ["inspector", "reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];

/** Finalize: reviewing officer only (plus admin overrides). */
const FINALIZE_ROLES = ["reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];

/** Read operations: inspectors, reviewing officers, and supervising officers. */
const READ_ROLES = ["inspector", "reviewing_officer", "supervising_officer", "inspection_admin", "tenant_admin", "super_admin"];

// ─── Zod validation schemas ─────────────────────────────────────────────────

/** Reusable UUID path param schema. */
const idParam = z.object({
  id: z.string().uuid("id must be a valid UUID"),
});

/** POST /inspections/:id/transition — trigger state transition (Req 8.1, 8.7). */
const transitionSchema = z.object({
  targetState: z.enum([
    "in_progress", "paused", "completed", "under_review", "finalized",
  ], { required_error: "targetState is required" }),
  remarks: z.string().max(1000).optional(),
});

/** POST /inspections/:id/submit-review — submit for review (Req 8.5). */
const submitReviewSchema = z.object({
  reviewerId: z.string().uuid("reviewerId must be a valid UUID"),
});

/** GET /inspections — list with pagination. */
const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(15),
});

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerExecutionRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/inspection/inspections/:id/transition (Req 8.1, 8.7, 8.8) ──
  app.post("/v1/inspection/inspections/:id/transition", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRANSITION_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionSchema.parse(req.body);
    const result = await publishInspectionTransition(
      { inspectionId: id, targetState: body.targetState, remarks: body.remarks },
      ctx,
    );
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/inspections/:id/submit-review (Req 8.5) ──
  app.post("/v1/inspection/inspections/:id/submit-review", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRANSITION_ROLES);
    const { id } = idParam.parse(req.params);
    const body = submitReviewSchema.parse(req.body);
    const result = await publishInspectionSubmitReview(
      { inspectionId: id, reviewerId: body.reviewerId },
      ctx,
    );
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/inspections/:id/finalize (Req 8.6) ──
  app.post("/v1/inspection/inspections/:id/finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINALIZE_ROLES);
    const { id } = idParam.parse(req.params);
    const result = await publishInspectionFinalize(
      { inspectionId: id },
      ctx,
    );
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/inspections/:id (Req 8.1) ──
  app.get("/v1/inspection/inspections/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const inspection = await findInspectionById(ctx.tenantId, id);
    if (!inspection) throw new HttpError(404, "NOT_FOUND", "inspection not found");
    return reply.send({ data: inspection });
  });

  // ── GET /v1/inspection/inspections (Req 8.1) ──
  app.get("/v1/inspection/inspections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listQuerySchema.parse(req.query);
    const result = await findInspections(ctx.tenantId, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return reply.send(result);
  });

  // ── GET /v1/inspection/inspections/:id/history (Req 8.8) ──
  app.get("/v1/inspection/inspections/:id/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const history = await findHistoryByInspection(ctx.tenantId, id);
    return reply.send({ data: history });
  });
}
