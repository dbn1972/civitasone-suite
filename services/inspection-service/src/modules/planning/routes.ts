/**
 * planning module — HTTP routes (Fastify plugin `registerPlanningRoutes`, 5 endpoints).
 *
 * Follows the suite CQRS + envelope conventions (structure.md, steering):
 *   • WRITES — `resolveContext` → `requireRole` → zod validate → command publish
 *              (planning/commands.ts) → 202 `{ data: Accepted }`. Routes NEVER write to
 *              Postgres directly; the planning consumer applies the change and emits the
 *              outbox event.
 *   • READS  — cache-first `repo.*` lookups (planning/repo.ts).
 *              Single entity → `{ data }`; lists →
 *              `{ data, meta: { page, pageSize, total } }`.
 *
 * Error paths (no per-route handler — the app-level `registerSchemaErrorHandler` maps them):
 *   • zod parse failure → 400 VALIDATION_FAILED
 *   • `resolveContext`  → 401 for unauthenticated callers
 *   • `requireRole`     → 403 FORBIDDEN
 *   • unknown / other-tenant id → 404 NOT_FOUND
 *   • optimistic-lock clash on a queued write → 409 VERSION_CONFLICT (from the consumer)
 *
 * RBAC (design.md § API Routes — Planning Module):
 *   • planning_officer  — POST/PATCH (create/modify/submit)
 *   • planning_officer + inspection_admin — GET (read/list)
 *
 * Endpoints (5):
 *   POST   /v1/inspection/plans              create inspection plan
 *   PATCH  /v1/inspection/plans/:id          modify draft plan
 *   POST   /v1/inspection/plans/:id/submit   submit plan for approval
 *   GET    /v1/inspection/plans/:id          get plan by ID
 *   GET    /v1/inspection/plans              list plans (paginated)
 *
 * _Requirements: 3.4, 3.5, 3.6, 3.7_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  publishPlanCreate,
  publishPlanModify,
  publishPlanSubmitApproval,
  type PlanCreatePayload,
} from "./commands.js";
import { findPlanById, findPlansByTenant } from "./repo.js";

// ─── RBAC role groups (design § API Routes — Planning Module) ────────────────

/** Write access: planning officers may create, modify, and submit plans. */
const WRITE_ROLES = ["planning_officer", "tenant_admin", "super_admin"];

/** Read access: planning officers and inspection administrators. */
const READ_ROLES = ["planning_officer", "inspection_admin", "tenant_admin", "super_admin"];

// ─── Zod validation schemas ─────────────────────────────────────────────────

/** POST /v1/inspection/plans — create inspection plan (Req 3.4). */
const createPlanSchema = z.object({
  name: z.string().min(1, "name is required"),
  periodStart: z.string().min(1, "periodStart is required"),
  periodEnd: z.string().min(1, "periodEnd is required"),
  riskThreshold: z.number().int().nonnegative().optional(),
  selectionCriteria: z.record(z.unknown()).optional(),
  entityIds: z.array(z.string().uuid()).min(1, "at least one entityId is required"),
  description: z.string().optional(),
});

/** PATCH /v1/inspection/plans/:id — modify draft plan (Req 3.5). */
const modifyPlanSchema = z.object({
  version: z.number().int().nonnegative("version must be a non-negative integer"),
  patch: z.record(z.unknown()).refine((val) => Object.keys(val).length > 0, {
    message: "patch must contain at least one field",
  }),
});

/** POST /v1/inspection/plans/:id/submit — submit plan for approval (Req 3.6). */
const submitPlanSchema = z.object({
  version: z.number().int().nonnegative("version must be a non-negative integer"),
});

/** Shared pagination query schema (offset-based, max 200 per API standards). */
const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
});

/** GET /v1/inspection/plans — list plans with optional status filter. */
const listPlansQuery = paginationQuery.extend({
  status: z.string().optional(),
});

/** Reusable UUID path param schema. */
const idParam = z.object({
  id: z.string().uuid("id must be a valid UUID"),
});

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerPlanningRoutes(app: FastifyInstance): Promise<void> {
  /** POST /v1/inspection/plans — create a new inspection plan (Req 3.4). */
  app.post("/v1/inspection/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createPlanSchema.parse(req.body) as PlanCreatePayload;
    const result = await publishPlanCreate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  /** PATCH /v1/inspection/plans/:id — modify a draft plan (Req 3.5). */
  app.patch("/v1/inspection/plans/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    // Verify plan exists and belongs to this tenant before publishing command
    const plan = await findPlanById(ctx.tenantId, id);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "inspection plan not found");

    // Assert plan is in draft status (modifiable)
    if (plan.status !== "draft") {
      throw new HttpError(422, "PLAN_NOT_MODIFIABLE", `Plan is in '${plan.status}' state. Only draft plans can be modified.`);
    }

    const body = modifyPlanSchema.parse(req.body);
    const result = await publishPlanModify({ planId: id, version: body.version, patch: body.patch }, ctx);
    return reply.code(202).send({ data: result });
  });

  /** POST /v1/inspection/plans/:id/submit — submit plan for approval (Req 3.6). */
  app.post("/v1/inspection/plans/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    // Verify plan exists and belongs to this tenant
    const plan = await findPlanById(ctx.tenantId, id);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "inspection plan not found");

    // Assert plan is in draft status
    if (plan.status !== "draft") {
      throw new HttpError(422, "PLAN_NOT_MODIFIABLE", `Plan is in '${plan.status}' state. Only draft plans can be submitted.`);
    }

    const body = submitPlanSchema.parse(req.body);
    const result = await publishPlanSubmitApproval({ planId: id, version: body.version }, ctx);
    return reply.code(202).send({ data: result });
  });

  /** GET /v1/inspection/plans/:id — get plan by ID via cache (Req 3.7). */
  app.get("/v1/inspection/plans/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const plan = await findPlanById(ctx.tenantId, id);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "inspection plan not found");
    return reply.send({ data: plan });
  });

  /** GET /v1/inspection/plans — paginated list of plans (Req 3.7). */
  app.get("/v1/inspection/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { page, pageSize, status } = listPlansQuery.parse(req.query);
    const result = await findPlansByTenant(ctx.tenantId, { page, pageSize }, status);
    return reply.send(result);
  });
}
