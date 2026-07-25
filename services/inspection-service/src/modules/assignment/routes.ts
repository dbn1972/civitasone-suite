/**
 * assignment module — HTTP routes (Fastify plugin `registerAssignmentRoutes`, 5 endpoints).
 *
 * Follows the suite CQRS + envelope conventions (structure.md, steering):
 *   • WRITES — `resolveContext` → `requireRole` → zod validate → command publish
 *              (assignment/commands.ts) → 202 `{ data: Accepted }`. Routes NEVER write to
 *              Postgres directly; the assignment consumer applies the change and emits the
 *              outbox event.
 *   • READS  — cache-first `repo.*` lookups (assignment/repo.ts).
 *              Single entity → `{ data }`; lists → `{ data, meta: { page, pageSize, total } }`.
 *
 * RBAC (design.md § API Routes — Assignment Module):
 *   • supervising_officer         — POST (assign, tour-plan generate)
 *   • inspector                   — POST geo-attendance, GET tour-plans
 *   • supervising_officer + inspector — GET assignments, GET tour-plans
 *
 * Endpoints (5):
 *   POST  /v1/inspection/assignments              assign inspector to inspection
 *   GET   /v1/inspection/assignments              list assignments (paginated)
 *   POST  /v1/inspection/tour-plans/generate      generate tour plan
 *   GET   /v1/inspection/tour-plans/:inspectorId  get inspector's tour plan
 *   POST  /v1/inspection/geo-attendance           mark geo-attendance
 *
 * _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 4.7, 4.8_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  publishInspectorAssign,
  publishTourPlanGenerate,
  publishGeoAttendanceMark,
  publishTourPlanSubmit,
  publishTourPlanApprove,
  type InspectorAssignPayload,
  type TourPlanGeneratePayload,
  type GeoAttendanceMarkPayload,
} from "./commands.js";
import { findAssignmentsByTenant, findTourPlan } from "./repo.js";

// ─── RBAC role groups (design § API Routes — Assignment Module) ──────────────

/** Write access: supervising officers manage assignments and tour plans. */
const SUPERVISING_ROLES = ["supervising_officer", "inspection_admin", "tenant_admin", "super_admin"];

/** Read access: inspectors and supervising officers. */
const READ_ROLES = ["inspector", "supervising_officer", "inspection_admin", "tenant_admin", "super_admin"];

/** Geo-attendance: only inspectors mark attendance. */
const INSPECTOR_ROLES = ["inspector", "tenant_admin", "super_admin"];

// ─── Zod validation schemas ─────────────────────────────────────────────────

/** POST /v1/inspection/assignments — assign inspector (Req 4.1, 4.2, 4.8). */
const assignInspectorSchema = z.object({
  inspectionId: z.string().uuid("inspectionId must be a valid UUID"),
  inspectorId: z.string().uuid("inspectorId must be a valid UUID"),
  inspectionTypeId: z.string().uuid("inspectionTypeId must be a valid UUID"),
  entityId: z.string().uuid("entityId must be a valid UUID"),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "scheduledDate must be YYYY-MM-DD"),
  competencies: z.array(z.string().min(1)).optional(),
  conflictCheckBypass: z.boolean().optional(),
});

/** POST /v1/inspection/tour-plans/generate — generate tour plan (Req 4.4). */
const tourSiteSchema = z.object({
  entityId: z.string().uuid("site.entityId must be a valid UUID"),
  inspectionId: z.string().uuid("site.inspectionId must be a valid UUID"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const generateTourPlanSchema = z.object({
  inspectorId: z.string().uuid("inspectorId must be a valid UUID"),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "periodStart must be YYYY-MM-DD"),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "periodEnd must be YYYY-MM-DD"),
  maxDailyInspections: z.number().int().positive().max(20).optional(),
  // SVC-109: optional geo-located site pool for proximity route optimization.
  sites: z.array(tourSiteSchema).max(500, "sites cannot exceed 500 per tour plan").optional(),
  startLatitude: z.number().min(-90).max(90).optional(),
  startLongitude: z.number().min(-180).max(180).optional(),
});

/** POST /v1/inspection/geo-attendance — mark geo-attendance (Req 4.5, 4.6). */
const markGeoAttendanceSchema = z.object({
  inspectionId: z.string().uuid("inspectionId must be a valid UUID"),
  inspectorId: z.string().uuid("inspectorId must be a valid UUID"),
  latitude: z.string().refine((v) => !isNaN(parseFloat(v)), "latitude must be numeric"),
  longitude: z.string().refine((v) => !isNaN(parseFloat(v)), "longitude must be numeric"),
  entityLatitude: z.string().refine((v) => !isNaN(parseFloat(v)), "entityLatitude must be numeric"),
  entityLongitude: z.string().refine((v) => !isNaN(parseFloat(v)), "entityLongitude must be numeric"),
  geofenceRadius: z.number().int().positive("geofenceRadius must be a positive integer"),
  deviceId: z.string().min(1, "deviceId is required"),
  timestamp: z.string().min(1, "timestamp is required"),
});

/** Shared pagination query schema (offset-based, max 200 per API standards). */
const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
});

/** GET /v1/inspection/assignments — list with optional filters. */
const listAssignmentsQuery = paginationQuery.extend({
  inspectorId: z.string().uuid().optional(),
  status: z.string().optional(),
});

/** GET /v1/inspection/tour-plans/:inspectorId — path param. */
const inspectorIdParam = z.object({
  inspectorId: z.string().uuid("inspectorId must be a valid UUID"),
});

/** Tour plan ID path param (SVC-109 approval workflow). */
const tourPlanIdParam = z.object({
  id: z.string().uuid("id must be a valid UUID"),
});

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerAssignmentRoutes(app: FastifyInstance): Promise<void> {
  // ── Assignments ─────────────────────────────────────────────────────────

  /** POST /v1/inspection/assignments — assign inspector to inspection (Req 4.1). */
  app.post("/v1/inspection/assignments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUPERVISING_ROLES);
    const body = assignInspectorSchema.parse(req.body) as InspectorAssignPayload;
    const result = await publishInspectorAssign(body, ctx);
    return reply.code(202).send({ data: result });
  });

  /** GET /v1/inspection/assignments — paginated list of assignments. */
  app.get("/v1/inspection/assignments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { page, pageSize, inspectorId, status } = listAssignmentsQuery.parse(req.query);
    const filters: { inspectorId?: string; status?: string } = {};
    if (inspectorId) filters.inspectorId = inspectorId;
    if (status) filters.status = status;
    const result = await findAssignmentsByTenant(
      ctx.tenantId,
      filters,
      { page, pageSize },
    );
    return reply.send(result);
  });

  // ── Tour Plans ──────────────────────────────────────────────────────────

  /** POST /v1/inspection/tour-plans/generate — generate tour plan (Req 4.4). */
  app.post("/v1/inspection/tour-plans/generate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUPERVISING_ROLES);
    const body = generateTourPlanSchema.parse(req.body) as TourPlanGeneratePayload;
    const result = await publishTourPlanGenerate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  /** GET /v1/inspection/tour-plans/:inspectorId — get inspector's tour plan. */
  app.get("/v1/inspection/tour-plans/:inspectorId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { inspectorId } = inspectorIdParam.parse(req.params);
    const plan = await findTourPlan(ctx.tenantId, inspectorId);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "tour plan not found for inspector");
    return reply.send({ data: plan });
  });

  // ── Geo-Attendance ──────────────────────────────────────────────────────

  /** POST /v1/inspection/geo-attendance — mark geo-attendance (Req 4.5, 4.6). */
  app.post("/v1/inspection/geo-attendance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INSPECTOR_ROLES);
    const body = markGeoAttendanceSchema.parse(req.body) as GeoAttendanceMarkPayload;
    const result = await publishGeoAttendanceMark(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── Tour Plan Approval Workflow (SVC-109) ─────────────────────────────────

  /** POST /v1/inspection/tour-plans/:id/submit — inspector submits tour plan for approval. */
  app.post("/v1/inspection/tour-plans/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INSPECTOR_ROLES);
    const { id } = tourPlanIdParam.parse(req.params);
    const result = await publishTourPlanSubmit({ tourPlanId: id }, ctx);
    return reply.code(202).send({ data: result });
  });

  /** POST /v1/inspection/tour-plans/:id/approve — supervising officer approves tour plan. */
  app.post("/v1/inspection/tour-plans/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUPERVISING_ROLES);
    const { id } = tourPlanIdParam.parse(req.params);
    const result = await publishTourPlanApprove({ tourPlanId: id }, ctx);
    return reply.code(202).send({ data: result });
  });
}
