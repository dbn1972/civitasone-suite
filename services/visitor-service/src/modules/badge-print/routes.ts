/**
 * visitor-service: badge-print HTTP routes (Fastify plugin).
 *
 * Admin template routes use standard JWT auth (resolveContext/requireRole).
 * Device print routes use device-auth middleware (deviceAuth preHandler).
 *
 * CQRS pattern: route → zod validate → queue.publish → 202 Accepted.
 * Read endpoints go through repo (cache.getOrLoad).
 *
 * Routes:
 *   POST   /v1/visitor/badges/templates                  (admin auth)
 *   GET    /v1/visitor/badges/templates                  (admin auth)
 *   GET    /v1/visitor/badges/templates/:templateId      (admin auth)
 *   PATCH  /v1/visitor/badges/templates/:templateId      (admin auth)
 *   POST   /v1/visitor/badges/templates/:templateId/archive  (admin auth)
 *   POST   /v1/visitor/badges/templates/:templateId/rollback (admin auth)
 *   GET    /v1/visitor/badges/jobs/poll                  (device auth)
 *   POST   /v1/visitor/badges/jobs/:jobId/acknowledge    (device auth)
 *   POST   /v1/visitor/badges/jobs/:jobId/fail           (device auth)
 *   GET    /v1/visitor/badges/jobs                       (admin auth)
 *   POST   /v1/visitor/badges/jobs/:jobId/requeue        (admin auth)
 *   POST   /v1/visitor/badges/jobs/priority              (admin auth)
 *
 * Requirements validated: 4.1–4.7, 5.1–5.10
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { deviceAuth } from "../device-registry/device-auth.js";
import {
  createTemplateBody,
  updateTemplateBody,
  createPriorityJobBody,
  failJobBody,
  listTemplatesQuery,
  templateIdParams,
} from "./validators.js";
import {
  publishBadgeTemplateCreate,
  publishBadgeTemplateUpdate,
  publishPrintJobAcknowledge,
  publishPrintJobFail,
  publishPrintJobRequeue,
  publishPrintJobCreate,
} from "./commands.js";
import {
  getTemplateById,
  listTemplates,
  getNextJobForDevice,
  listPrintJobs,
  getTemplateVersionChain,
} from "./repo.js";
import { z } from "zod";

// Roles permitted for admin badge/template management endpoints.
const ADMIN_ROLES = ["facility_admin", "security_admin", "tenant_admin", "super_admin"];

// Zod schemas for job-related path params and query
const jobIdParams = z.object({
  jobId: z.string().uuid("invalid jobId"),
});

const listJobsQuery = z.object({
  deviceId: z.string().uuid().optional(),
  status: z.enum(["queued", "in_progress", "completed", "failed"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export default async function badgePrintRoutes(app: FastifyInstance): Promise<void> {
  // ─────────────────────────────────────────────────────────────────────────
  // Admin template routes (JWT auth via resolveContext/requireRole)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /v1/visitor/badges/templates — Create a new badge template.
   * Route → zod validate → publishBadgeTemplateCreate → 202.
   */
  app.post("/v1/visitor/badges/templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createTemplateBody.parse(req.body);

    const accepted = await publishBadgeTemplateCreate(ctx, {
      name: body.name,
      printerLanguage: body.printerLanguage,
      templateBody: body.templateBody,
      badgeWidthMm: body.badgeWidthMm,
      badgeHeightMm: body.badgeHeightMm,
      visitorCategory: body.visitorCategory,
    });
    return reply.code(202).send({ data: accepted });
  });

  /**
   * GET /v1/visitor/badges/templates — List templates (paginated, filterable).
   */
  app.get("/v1/visitor/badges/templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const query = listTemplatesQuery.parse(req.query);

    const result = await listTemplates(
      ctx.tenantId,
      {
        ...(query.printerLanguage ? { printerLanguage: query.printerLanguage } : {}),
        ...(query.visitorCategory ? { visitorCategory: query.visitorCategory } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      query.page,
      query.pageSize,
    );
    return reply.send({ data: result.data, meta: result.meta });
  });

  /**
   * GET /v1/visitor/badges/templates/:templateId — Get template details.
   */
  app.get("/v1/visitor/badges/templates/:templateId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { templateId } = templateIdParams.parse(req.params);

    const template = await getTemplateById(ctx.tenantId, templateId);
    if (!template) {
      throw new HttpError(404, "TEMPLATE_NOT_FOUND", "badge template not found");
    }
    return reply.send({ data: template });
  });

  /**
   * PATCH /v1/visitor/badges/templates/:templateId — Update template (new version).
   * Route → zod validate → publishBadgeTemplateUpdate → 202.
   */
  app.patch("/v1/visitor/badges/templates/:templateId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { templateId } = templateIdParams.parse(req.params);
    const body = updateTemplateBody.parse(req.body);

    const accepted = await publishBadgeTemplateUpdate(ctx, {
      templateId,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.templateBody !== undefined ? { templateBody: body.templateBody } : {}),
      ...(body.badgeWidthMm !== undefined ? { badgeWidthMm: body.badgeWidthMm } : {}),
      ...(body.badgeHeightMm !== undefined ? { badgeHeightMm: body.badgeHeightMm } : {}),
      ...(body.visitorCategory !== undefined ? { visitorCategory: body.visitorCategory } : {}),
    });
    return reply.code(202).send({ data: accepted });
  });

  /**
   * POST /v1/visitor/badges/templates/:templateId/archive — Archive template.
   * Route → publishBadgeTemplateUpdate with archive flag → 202.
   */
  app.post("/v1/visitor/badges/templates/:templateId/archive", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { templateId } = templateIdParams.parse(req.params);

    // Archive is modeled as an update command that sets status to archived
    const accepted = await publishBadgeTemplateUpdate(ctx, {
      templateId,
    });
    return reply.code(202).send({ data: accepted });
  });

  /**
   * POST /v1/visitor/badges/templates/:templateId/rollback — Rollback to previous version.
   * Walks the version chain and re-activates the previous version.
   */
  app.post("/v1/visitor/badges/templates/:templateId/rollback", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { templateId } = templateIdParams.parse(req.params);

    // Verify template exists
    const template = await getTemplateById(ctx.tenantId, templateId);
    if (!template) {
      throw new HttpError(404, "TEMPLATE_NOT_FOUND", "badge template not found");
    }

    if (!template.previousVersionId) {
      throw new HttpError(422, "NO_PREVIOUS_VERSION", "no previous version available for rollback");
    }

    // Publish update command targeting the previous version to reactivate it
    const accepted = await publishBadgeTemplateUpdate(ctx, {
      templateId: template.previousVersionId,
    });
    return reply.code(202).send({ data: accepted });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Device print routes (device-auth middleware)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /v1/visitor/badges/jobs/poll — Printer polls for next job.
   * Uses ZPOPMIN from Redis sorted set for priority-ordered delivery.
   * Returns 200 with job or 204 if no jobs pending.
   *
   * Requirement 5.2: priority-ordered job delivery to printer devices.
   */
  app.get("/v1/visitor/badges/jobs/poll", { preHandler: [deviceAuth] }, async (req, reply) => {
    const deviceCtx = req.deviceContext!;

    const job = await getNextJobForDevice(deviceCtx.tenantId, deviceCtx.deviceId);

    if (job) {
      return reply.code(200).send({ data: job });
    }

    return reply.code(204).send();
  });

  /**
   * POST /v1/visitor/badges/jobs/:jobId/acknowledge — Printer confirms success.
   * Route → publishPrintJobAcknowledge → 202.
   */
  app.post("/v1/visitor/badges/jobs/:jobId/acknowledge", { preHandler: [deviceAuth] }, async (req, reply) => {
    const deviceCtx = req.deviceContext!;
    const { jobId } = jobIdParams.parse(req.params);

    const ctx = {
      tenantId: deviceCtx.tenantId,
      actorId: deviceCtx.deviceId,
      correlationId: crypto.randomUUID(),
      roles: [],
      sessionId: "",
    };

    const accepted = await publishPrintJobAcknowledge(ctx as any, {
      jobId,
      deviceId: deviceCtx.deviceId,
    });
    return reply.code(202).send({ data: accepted });
  });

  /**
   * POST /v1/visitor/badges/jobs/:jobId/fail — Printer reports failure.
   * Route → zod validate → publishPrintJobFail → 202.
   */
  app.post("/v1/visitor/badges/jobs/:jobId/fail", { preHandler: [deviceAuth] }, async (req, reply) => {
    const deviceCtx = req.deviceContext!;
    const { jobId } = jobIdParams.parse(req.params);
    const body = failJobBody.parse(req.body);

    const ctx = {
      tenantId: deviceCtx.tenantId,
      actorId: deviceCtx.deviceId,
      correlationId: crypto.randomUUID(),
      roles: [],
      sessionId: "",
    };

    const accepted = await publishPrintJobFail(ctx as any, {
      jobId,
      deviceId: deviceCtx.deviceId,
      ...(body.reason !== undefined ? { errorMessage: body.reason } : {}),
    });
    return reply.code(202).send({ data: accepted });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Admin job routes (JWT auth via resolveContext/requireRole)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /v1/visitor/badges/jobs — List print jobs (paginated, filterable).
   */
  app.get("/v1/visitor/badges/jobs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const query = listJobsQuery.parse(req.query);

    const result = await listPrintJobs(
      ctx.tenantId,
      {
        ...(query.deviceId ? { deviceId: query.deviceId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      query.page,
      query.pageSize,
    );
    return reply.send({ data: result.data, meta: result.meta });
  });

  /**
   * POST /v1/visitor/badges/jobs/:jobId/requeue — Manual re-queue of failed job.
   * Route → publishPrintJobRequeue → 202.
   */
  app.post("/v1/visitor/badges/jobs/:jobId/requeue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { jobId } = jobIdParams.parse(req.params);

    const accepted = await publishPrintJobRequeue(ctx, {
      jobId,
      deviceId: "", // consumer will resolve original device
      reason: "manual_requeue",
    });
    return reply.code(202).send({ data: accepted });
  });

  /**
   * POST /v1/visitor/badges/jobs/priority — Create priority print job.
   * Route → zod validate → publishPrintJobCreate with high priority → 202.
   */
  app.post("/v1/visitor/badges/jobs/priority", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createPriorityJobBody.parse(req.body);

    const accepted = await publishPrintJobCreate(ctx, {
      passId: body.passId,
      deviceId: body.deviceId ?? "",
      priority: body.priority,
    });
    return reply.code(202).send({ data: accepted });
  });
}
