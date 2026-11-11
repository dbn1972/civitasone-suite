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
 * Endpoints (9):
 *   POST /v1/inspection/inspections                     — schedule a new inspection (optionally linked to a plan)
 *   POST /v1/inspection/inspections/:id/start           — start it (scheduled → in_progress); conducting inspector
 *   POST /v1/inspection/inspections/:id/complete        — complete it (in_progress → completed) with remarks; conducting inspector
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
import type { RequestContext } from "@civitasone/types";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { randomUUID } from "node:crypto";
import { mayConduct } from "./domain.js";
import { findEntityById, findInspectionTypeById } from "../universe/repo.js";
import { findPlanById } from "../planning/repo.js";
import {
  publishInspectionCreate,
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

/** Scheduling a new inspection: supervising officers and admins (same group as inspector assignment). */
const CREATE_ROLES = ["supervising_officer", "inspection_admin", "tenant_admin", "super_admin"];

/** Transition operations: inspectors and reviewing officers. */
const TRANSITION_ROLES = ["inspector", "reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];

/**
 * Conducting the inspection (start / complete): the inspector it is assigned to. Officers schedule and
 * review but do not conduct; admins may act for an inspector.
 */
const CONDUCT_ROLES = ["inspector", "inspection_admin", "tenant_admin", "super_admin"];

/** Finalize: reviewing officer only (plus admin overrides). */
const FINALIZE_ROLES = ["reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];

/** Read operations: inspectors, reviewing officers, and supervising officers. */
const READ_ROLES = ["inspector", "reviewing_officer", "supervising_officer", "inspection_admin", "tenant_admin", "super_admin"];

// ─── Zod validation schemas ─────────────────────────────────────────────────

/** Reusable UUID path param schema. */
const idParam = z.object({
  id: z.string().uuid("id must be a valid UUID"),
});

/** POST /inspections — schedule a new inspection for a regulated entity. */
const createSchema = z.object({
  entityId: z.string().uuid("entityId must be a valid UUID"),
  inspectionTypeId: z.string().uuid("inspectionTypeId must be a valid UUID"),
  planId: z.string().uuid("planId must be a valid UUID").optional(),
  assignedInspectors: z.array(z.string().uuid()).max(50).default([]),
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

/** POST /inspections/:id/complete — remarks are mandatory: they are the inspector's record of the run. */
const completeSchema = z.object({
  remarks: z.string({ required_error: "remarks is required" }).trim().min(1, "remarks is required").max(1000),
});

/** POST /inspections/:id/start — remarks optional. */
const startSchema = z.object({ remarks: z.string().trim().max(1000).optional() }).default({});

/** GET /inspections — list with pagination. */
const listQuerySchema = z.object({
  planId: z.string().uuid("planId must be a valid UUID").optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(15),
});

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerExecutionRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/inspection/inspections — schedule an inspection ──
  // Before this route nothing in the service could create an execution.inspections row, so no
  // inspection could ever be listed, transitioned or reported on through the API.
  app.post("/v1/inspection/inspections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CREATE_ROLES);
    const body = createSchema.parse(req.body);
    // Tenant-scoped existence reads before publishing; the consumer re-checks inside its tx.
    if (!(await findEntityById(ctx.tenantId, body.entityId))) throw new HttpError(404, "NOT_FOUND", "regulated entity not found");
    if (!(await findInspectionTypeById(ctx.tenantId, body.inspectionTypeId))) throw new HttpError(404, "NOT_FOUND", "inspection type not found");
    if (body.planId && !(await findPlanById(ctx.tenantId, body.planId))) throw new HttpError(404, "NOT_FOUND", "inspection plan not found");
    const result = await publishInspectionCreate(
      {
        inspectionId: randomUUID(),
        entityId: body.entityId,
        inspectionTypeId: body.inspectionTypeId,
        planId: body.planId,
        assignedInspectors: body.assignedInspectors,
      },
      ctx,
    );
    return reply.code(202).send({ data: result });
  });

  // The inspector it is assigned to (or an admin) may conduct an inspection; fast-fail with a clear
  // 409 on the wrong state. The consumer remains the race-safe state-machine check. (The role gate itself
  // is in each handler so the authz scanner sees it.)
  async function loadForConduct(ctx: RequestContext, rawParams: unknown, expected: string) {
    const { id } = idParam.parse(rawParams);
    const inspection = await findInspectionById(ctx.tenantId, id);
    if (!inspection) throw new HttpError(404, "NOT_FOUND", "inspection not found");
    if (!mayConduct(inspection.assignedInspectors, ctx.actorId, ctx.roles)) {
      throw new HttpError(403, "NOT_ASSIGNED", "only an inspector assigned to this inspection may conduct it");
    }
    if (inspection.state !== expected) {
      throw new HttpError(409, "INVALID_TRANSITION", `inspection is '${inspection.state}'; it must be '${expected}'`);
    }
    return id;
  }

  // ── POST /v1/inspection/inspections/:id/start — scheduled → in_progress ──
  app.post("/v1/inspection/inspections/:id/start", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONDUCT_ROLES);
    const id = await loadForConduct(ctx, req.params, "scheduled");
    const body = startSchema.parse(req.body ?? {});
    const result = await publishInspectionTransition(
      { inspectionId: id, targetState: "in_progress", remarks: body.remarks ?? "Inspection started" },
      ctx,
    );
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/inspections/:id/complete — in_progress → completed ──
  app.post("/v1/inspection/inspections/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONDUCT_ROLES);
    const id = await loadForConduct(ctx, req.params, "in_progress");
    const body = completeSchema.parse(req.body ?? {});
    const result = await publishInspectionTransition(
      { inspectionId: id, targetState: "completed", remarks: body.remarks },
      ctx,
    );
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/inspections/:id/transition (Req 8.1, 8.7, 8.8) ──
  app.post("/v1/inspection/inspections/:id/transition", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRANSITION_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionSchema.parse(req.body);
    // UAT W8-B: tenant-scoped existence read before publishing; the consumer stays the race-safe check.
    const current = await findInspectionById(ctx.tenantId, id);
    if (!current) throw new HttpError(404, "NOT_FOUND", "inspection not found");
    // Starting / completing / resuming is for the assigned inspector (or an admin), exactly as /start and
    // /complete; the reviewer's return-for-revision edge is exempt. Everything else is unchanged.
    if (!mayConduct(current.assignedInspectors, ctx.actorId, ctx.roles, { from: current.state, to: body.targetState })) {
      throw new HttpError(403, "NOT_ASSIGNED", "only an inspector assigned to this inspection may conduct it");
    }
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
    // UAT W8-B: tenant-scoped existence read before publishing; the consumer stays the race-safe check.
    if (!(await findInspectionById(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "inspection not found");
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
    // UAT W8-B: tenant-scoped existence read before publishing; the consumer stays the race-safe check.
    if (!(await findInspectionById(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "inspection not found");
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
    }, query.planId);
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
